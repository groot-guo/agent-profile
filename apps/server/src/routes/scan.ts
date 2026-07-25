import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  analyzeSession,
  detectAgent,
  findTranscriptFiles,
  hasZedThreadsDb,
  parseCodexTranscript,
  parseMiMoSession,
  parseTranscript,
  parseZedThread,
  readTranscript,
  type ScanResult,
  type Span,
  zedThreadsDbPath,
} from '@agent-profile/core';
import type { ZedThreadMeta } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { db, getPricing } from '../db';
import { SESSION_COLS } from './shared';

interface ScanBody {
  dir: string;
  agent?: string;
}

export function registerScanRoutes(app: FastifyInstance) {
  // 扫描 + 增量更新（mtime/size 未变跳过，变了删旧重插）
  app.post<{ Body: ScanBody }>('/api/scan', async (req, reply) => {
    const { dir } = req.body;
    if (!dir) return reply.status(400).send({ error: 'dir required' });
    const files = await findTranscriptFiles(dir);
    let imported = 0,
      skipped = 0,
      updated = 0;
    const sessionIds: string[] = [];

    const insertSession = db.prepare(`
      INSERT INTO sessions (id, name, file_path, agent, file_mtime, file_size, file_lines, start_time, end_time,
        cwd, git_branch, claude_version, input_tokens, cache_creation_tokens, cache_read_tokens,
        output_tokens, total_cost, cost_unknown_count, peak_context_tokens, avg_context_tokens,
        cache_hit_rate, message_count, imported_at)
      VALUES (@id, @name, @filePath, @agent, @fileMtime, @fileSize, @fileLines, @startTime, @endTime,
        @cwd, @gitBranch, @claudeVersion, @inputTokens, @cacheCreationTokens, @cacheReadTokens,
        @outputTokens, @totalCost, @costUnknownCount, @peakContextTokens, @avgContextTokens,
        @cacheHitRate, @messageCount, @importedAt)
    `);
    const insertSpan = db.prepare(`
      INSERT OR REPLACE INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
        input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, context_tokens,
        output_bytes, model, cost, cost_unknown, stop_reason, is_error, is_sidechain, metadata)
      VALUES (@id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
        @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @contextTokens,
        @outputBytes, @model, @cost, @costUnknown, @stopReason, @isError, @isSidechain, @metadata)
    `);
    const delSpans = db.prepare('DELETE FROM spans WHERE session_id = ?');
    const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');
    const getExisting = db.prepare('SELECT file_mtime, file_size FROM sessions WHERE id = ?');
    const tx = db.transaction((rows: Span[]) => {
      for (const s of rows)
        insertSpan.run({
          id: s.id,
          sessionId: s.sessionId,
          parentId: s.parentId ?? null,
          type: s.type,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime ?? null,
          inputTokens: s.inputTokens,
          cacheCreationTokens: s.cacheCreationTokens,
          cacheReadTokens: s.cacheReadTokens,
          outputTokens: s.outputTokens,
          contextTokens: s.contextTokens,
          outputBytes: s.outputBytes,
          model: s.model ?? null,
          cost: s.cost,
          costUnknown: s.costUnknown ? 1 : 0,
          stopReason: s.stopReason ?? null,
          isError: s.isError ? 1 : 0,
          isSidechain: s.isSidechain ? 1 : 0,
          metadata: s.metadata ? JSON.stringify(s.metadata) : null,
        });
    });

    for (const file of files) {
      const st = statSync(file);
      const mtime = st.mtimeMs,
        size = st.size;
      const entries = await readTranscript(file);
      const lines = entries.length;
      const agent = detectAgent(file);
      const parsed = agent === 'codex'
        ? parseCodexTranscript(entries as any, { filePath: file })
        : parseTranscript(entries, { filePath: file, agent });
      if (!parsed) {
        skipped++;
        continue;
      }

      const existing = getExisting.get(parsed.sessionId) as
        | { file_mtime: number; file_size: number }
        | undefined;
      if (existing && existing.file_mtime === mtime && existing.file_size === size) {
        skipped++;
        continue; // 未变
      }
      if (existing) {
        delSpans.run(parsed.sessionId);
        delSession.run(parsed.sessionId);
        updated++;
      } else {
        imported++;
      }

      const { summary, spans } = analyzeSession(parsed, getPricing, { mtime, size, lines }, Date.now());
      insertSession.run({
        id: summary.id,
        name: summary.name ?? null,
        filePath: summary.filePath,
        agent: summary.agent,
        fileMtime: mtime,
        fileSize: size,
        fileLines: lines,
        startTime: summary.startTime,
        endTime: summary.endTime ?? null,
        cwd: summary.cwd ?? null,
        gitBranch: summary.gitBranch ?? null,
        claudeVersion: summary.claudeVersion ?? null,
        inputTokens: summary.inputTokens,
        cacheCreationTokens: summary.cacheCreationTokens,
        cacheReadTokens: summary.cacheReadTokens,
        outputTokens: summary.outputTokens,
        totalCost: summary.totalCost,
        costUnknownCount: summary.costUnknownCount,
        peakContextTokens: summary.peakContextTokens,
        avgContextTokens: summary.avgContextTokens,
        cacheHitRate: summary.cacheHitRate,
        messageCount: summary.messageCount,
        importedAt: summary.importedAt,
      });
      tx(spans);
      sessionIds.push(summary.id);
    }

    const result: ScanResult = { scanned: files.length, imported, skipped, updated, sessionIds };
    return result;
  });
}

// 供 index.ts 启动自动扫描使用
export async function autoScan(dir: string) {
  const files = await findTranscriptFiles(dir);
  if (files.length === 0) return { scanned: 0, imported: 0 };

  const insertSession = db.prepare(`
    INSERT INTO sessions (id, name, file_path, agent, file_mtime, file_size, file_lines, start_time, end_time,
      cwd, git_branch, claude_version, input_tokens, cache_creation_tokens, cache_read_tokens,
      output_tokens, total_cost, cost_unknown_count, peak_context_tokens, avg_context_tokens,
      cache_hit_rate, message_count, imported_at)
    VALUES (@id, @name, @filePath, @agent, @fileMtime, @fileSize, @fileLines, @startTime, @endTime,
      @cwd, @gitBranch, @claudeVersion, @inputTokens, @cacheCreationTokens, @cacheReadTokens,
      @outputTokens, @totalCost, @costUnknownCount, @peakContextTokens, @avgContextTokens,
      @cacheHitRate, @messageCount, @importedAt)
  `);
  const insertSpan = db.prepare(`
    INSERT OR REPLACE INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, context_tokens,
      output_bytes, model, cost, cost_unknown, stop_reason, is_error, is_sidechain, metadata)
    VALUES (@id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
      @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @contextTokens,
      @outputBytes, @model, @cost, @costUnknown, @stopReason, @isError, @isSidechain, @metadata)
  `);
  const delSpans = db.prepare('DELETE FROM spans WHERE session_id = ?');
  const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const getExisting = db.prepare('SELECT file_mtime, file_size FROM sessions WHERE id = ?');

  let imported = 0;
  for (const file of files) {
    try {
      const st = statSync(file);
      const mtime = st.mtimeMs,
        size = st.size;
      const entries = await readTranscript(file);
      const agent = detectAgent(file);
      const parsed = agent === 'codex'
        ? parseCodexTranscript(entries as any, { filePath: file })
        : parseTranscript(entries, { filePath: file, agent });
      if (!parsed) continue;

      const existing = getExisting.get(parsed.sessionId) as
        | { file_mtime: number; file_size: number }
        | undefined;
      if (existing && existing.file_mtime === mtime && existing.file_size === size) continue;

      const runAll = db.transaction(() => {
        if (existing) {
          delSpans.run(parsed.sessionId);
          delSession.run(parsed.sessionId);
        }
        const { summary, spans } = analyzeSession(parsed, getPricing, { mtime, size, lines: entries.length }, Date.now());
        insertSession.run({
          id: summary.id,
          name: summary.name ?? null,
          filePath: summary.filePath,
          agent: summary.agent,
          fileMtime: mtime,
          fileSize: size,
          fileLines: entries.length,
          startTime: summary.startTime,
          endTime: summary.endTime ?? null,
          cwd: summary.cwd ?? null,
          gitBranch: summary.gitBranch ?? null,
          claudeVersion: summary.claudeVersion ?? null,
          inputTokens: summary.inputTokens,
          cacheCreationTokens: summary.cacheCreationTokens,
          cacheReadTokens: summary.cacheReadTokens,
          outputTokens: summary.outputTokens,
          totalCost: summary.totalCost,
          costUnknownCount: summary.costUnknownCount,
          peakContextTokens: summary.peakContextTokens,
          avgContextTokens: summary.avgContextTokens,
          cacheHitRate: summary.cacheHitRate,
          messageCount: summary.messageCount,
          importedAt: summary.importedAt,
        });
        for (const s of spans)
          insertSpan.run({
            id: s.id,
            sessionId: s.sessionId,
            parentId: s.parentId ?? null,
            type: s.type,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime ?? null,
            inputTokens: s.inputTokens,
            cacheCreationTokens: s.cacheCreationTokens,
            cacheReadTokens: s.cacheReadTokens,
            outputTokens: s.outputTokens,
            contextTokens: s.contextTokens,
            outputBytes: s.outputBytes,
            model: s.model ?? null,
            cost: s.cost,
            costUnknown: s.costUnknown ? 1 : 0,
            stopReason: s.stopReason ?? null,
            isError: s.isError ? 1 : 0,
            isSidechain: s.isSidechain ? 1 : 0,
            metadata: s.metadata ? JSON.stringify(s.metadata) : null,
          });
      });
      runAll();
      imported++;
    } catch (err) {
      // 单个文件失败不阻塞其他文件
      console.warn(`Auto-scan: skip ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { scanned: files.length, imported };
}

// 扫描 Zed threads.db，注册线程元数据为 session（暂不解析 zstd BLOB）
export async function scanZedThreads(): Promise<{ scanned: number; imported: number }> {
  if (!hasZedThreadsDb()) return { scanned: 0, imported: 0 };

  const zedDb = new (await import('better-sqlite3')).default(zedThreadsDbPath(), { readonly: true });
  const threads = zedDb
    .prepare('SELECT id, summary, folder_paths, updated_at, created_at FROM threads')
    .all() as ZedThreadMeta[];
  zedDb.close();

  if (threads.length === 0) return { scanned: 0, imported: 0 };

  // 需要解压 zstd BLOB
  const { decompress } = await import('simple-zstd');

  const getExisting = db.prepare('SELECT id FROM sessions WHERE id = ?');
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, name, file_path, agent, start_time, end_time, cwd, imported_at)
    VALUES (@id, @name, @filePath, @agent, @startTime, @endTime, @cwd, @importedAt)
  `);
  const insertSpan = db.prepare(`
    INSERT OR REPLACE INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, context_tokens,
      output_bytes, model, cost, cost_unknown, stop_reason, is_error, is_sidechain, metadata)
    VALUES (@id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
      @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @contextTokens,
      @outputBytes, @model, @cost, @costUnknown, @stopReason, @isError, @isSidechain, @metadata)
  `);
  const delSpans = db.prepare('DELETE FROM spans WHERE session_id = ?');
  const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const now = Date.now();

  let imported = 0;
  for (const t of threads) {
    try {
      const existing = getExisting.get(t.id);
      if (existing) {
        // 已存在则跳过（后续可加 updated_at 检测实现增量）
        continue;
      }

      // 读取并解压 data BLOB
      const zedDb2 = new (await import('better-sqlite3')).default(zedThreadsDbPath(), { readonly: true });
      const row = zedDb2.prepare('SELECT data_type, data FROM threads WHERE id = ?').get(t.id) as
        | { data_type: string; data: Buffer }
        | undefined;
      zedDb2.close();

      if (!row || !row.data || row.data.length === 0) continue;

      const dataBuffer = decompress(row.data);
      const parsed = await parseZedThread({
        id: t.id,
        summary: t.summary,
        folderPaths: t.folder_paths,
        updatedAt: t.updated_at,
        createdAt: t.created_at,
        dataType: row.data_type,
        dataBuffer,
      });
      if (!parsed) continue;

      const { summary, spans } = analyzeSession(parsed, getPricing, undefined, now);

      delSpans.run(t.id);
      delSession.run(t.id);
      insertSession.run({
        id: summary.id,
        name: summary.name ?? null,
        filePath: summary.filePath,
        agent: 'zed',
        startTime: summary.startTime,
        endTime: summary.endTime ?? null,
        cwd: summary.cwd ?? null,
        importedAt: now,
      });
      for (const s of spans) {
        insertSpan.run({
          id: s.id, sessionId: s.sessionId, parentId: s.parentId ?? null,
          type: s.type, name: s.name, startTime: s.startTime, endTime: s.endTime ?? null,
          inputTokens: s.inputTokens, cacheCreationTokens: s.cacheCreationTokens,
          cacheReadTokens: s.cacheReadTokens, outputTokens: s.outputTokens,
          contextTokens: s.contextTokens, outputBytes: s.outputBytes,
          model: s.model ?? null, cost: s.cost, costUnknown: s.costUnknown ? 1 : 0,
          stopReason: s.stopReason ?? null, isError: s.isError ? 1 : 0,
          isSidechain: s.isSidechain ? 1 : 0,
          metadata: s.metadata ? JSON.stringify(s.metadata) : null,
        });
      }
      imported++;
    } catch (err) {
      console.warn(`Zed thread ${t.id} parse failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { scanned: threads.length, imported };
}

// 扫描 MiMo Code 数据库
const MIMO_DB_PATH = `${homedir()}/.local/share/mimocode/mimocode.db`;

export async function scanMiMoSessions(): Promise<{ scanned: number; imported: number }> {
  let exists: boolean;
  try { const s = statSync(MIMO_DB_PATH); exists = !!s; } catch { exists = false; }
  if (!exists) return { scanned: 0, imported: 0 };

  const mimoDb = new (await import('better-sqlite3')).default(MIMO_DB_PATH, { readonly: true });
  const sessions = mimoDb.prepare('SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_created DESC').all() as {
    id: string; title: string; directory: string; time_created: number; time_updated: number;
  }[];
  if (sessions.length === 0) { mimoDb.close(); return { scanned: 0, imported: 0 }; }

  const getExisting = db.prepare('SELECT id FROM sessions WHERE id = ?');
  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, name, file_path, agent, start_time, end_time, cwd, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, total_cost, cost_unknown_count, peak_context_tokens, avg_context_tokens, cache_hit_rate, message_count, imported_at)
    VALUES (@id, @name, @filePath, @agent, @startTime, @endTime, @cwd, @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @totalCost, @costUnknownCount, @peakContextTokens, @avgContextTokens, @cacheHitRate, @messageCount, @importedAt)
  `);
  const insertSpan = db.prepare(`
    INSERT OR REPLACE INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, context_tokens,
      output_bytes, model, cost, cost_unknown, stop_reason, is_error, is_sidechain, metadata)
    VALUES (@id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
      @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @contextTokens,
      @outputBytes, @model, @cost, @costUnknown, @stopReason, @isError, @isSidechain, @metadata)
  `);
  const delSpans = db.prepare('DELETE FROM spans WHERE session_id = ?');
  const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');

  // 预加载所有 messages + parts
  const allMessages = mimoDb.prepare('SELECT id, session_id, agent_id, data FROM message ORDER BY time_created').all() as {
    id: string; session_id: string; agent_id: string; data: string;
  }[];
  const allParts = mimoDb.prepare('SELECT id, message_id, session_id, data FROM part').all() as {
    id: string; message_id: string; session_id: string; data: string;
  }[];
  mimoDb.close();

  // 按 session 分组
  const msgBySession = new Map<string, typeof allMessages>();
  const partByMsg = new Map<string, typeof allParts>();
  for (const m of allMessages) {
    const arr = msgBySession.get(m.session_id) || [];
    arr.push(m);
    msgBySession.set(m.session_id, arr);
  }
  for (const p of allParts) {
    const arr = partByMsg.get(p.message_id) || [];
    arr.push(p);
    partByMsg.set(p.message_id, arr);
  }

  const now = Date.now();
  let imported = 0;
  for (const s of sessions) {
    try {
      const existing = getExisting.get(s.id);
      if (existing) continue;

      const msgs = msgBySession.get(s.id) || [];
      const messages = [];
      for (const m of msgs) {
        try {
          const data = JSON.parse(m.data);
          const parts = (partByMsg.get(m.id) || []).map((p) => {
            try { return { id: p.id, data: JSON.parse(p.data) }; }
            catch { return { id: p.id, data: { type: 'text', text: '' } }; }
          });
          messages.push({ id: m.id, agent_id: m.agent_id, data, parts });
        } catch {
          // 跳过损坏的消息行
        }
      }

      const parsed = parseMiMoSession(s, messages as any);
      if (!parsed) continue;

      const { summary, spans } = analyzeSession(parsed, getPricing, undefined, now);
      delSpans.run(s.id);
      delSession.run(s.id);
      insertSession.run({
        id: summary.id, name: summary.name ?? null, filePath: summary.filePath,
        agent: 'mimo-code', startTime: summary.startTime, endTime: summary.endTime ?? null,
        cwd: summary.cwd ?? null,
        inputTokens: summary.inputTokens, cacheCreationTokens: summary.cacheCreationTokens,
        cacheReadTokens: summary.cacheReadTokens, outputTokens: summary.outputTokens,
        totalCost: summary.totalCost, costUnknownCount: summary.costUnknownCount,
        peakContextTokens: summary.peakContextTokens, avgContextTokens: summary.avgContextTokens,
        cacheHitRate: summary.cacheHitRate, messageCount: summary.messageCount, importedAt: now,
      });
      for (const sp of spans) {
        insertSpan.run({
          id: sp.id, sessionId: sp.sessionId, parentId: sp.parentId ?? null,
          type: sp.type, name: sp.name, startTime: sp.startTime, endTime: sp.endTime ?? null,
          inputTokens: sp.inputTokens, cacheCreationTokens: sp.cacheCreationTokens,
          cacheReadTokens: sp.cacheReadTokens, outputTokens: sp.outputTokens,
          contextTokens: sp.contextTokens, outputBytes: sp.outputBytes,
          model: sp.model ?? null, cost: sp.cost, costUnknown: sp.costUnknown ? 1 : 0,
          stopReason: sp.stopReason ?? null, isError: sp.isError ? 1 : 0,
          isSidechain: sp.isSidechain ? 1 : 0,
          metadata: sp.metadata ? JSON.stringify(sp.metadata) : null,
        });
      }
      imported++;
    } catch (err) {
      console.warn(`MiMo session ${s.id} parse failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { scanned: sessions.length, imported };
}

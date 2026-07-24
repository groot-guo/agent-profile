import { statSync } from 'node:fs';
import {
  AGENT_LABELS,
  analyzeSession,
  detectAgent,
  findTranscriptFiles,
  hasZedThreadsDb,
  parseTranscript,
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
      INSERT INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
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
      const parsed = parseTranscript(entries, { filePath: file, agent });
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
    INSERT INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
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
      const parsed = parseTranscript(entries, { filePath: file, agent });
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

  const getExisting = db.prepare('SELECT id FROM sessions WHERE id = ?');
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, name, file_path, agent, start_time, end_time, cwd, imported_at)
    VALUES (@id, @name, @filePath, @agent, @startTime, @endTime, @cwd, @importedAt)
  `);
  const now = Date.now();

  let imported = 0;
  for (const t of threads) {
    const existing = getExisting.get(t.id);
    if (existing) continue;

    const startTime = t.createdAt ? new Date(t.createdAt).getTime() : new Date(t.updatedAt).getTime();
    const endTime = new Date(t.updatedAt).getTime();

    insertSession.run({
      id: t.id,
      name: t.summary,
      filePath: `zed://threads/${t.id}`,
      agent: 'zed',
      startTime,
      endTime,
      cwd: t.folderPaths ? JSON.parse(t.folderPaths)[0] : null,
      importedAt: now,
    });
    imported++;
  }

  return { scanned: threads.length, imported };
}

import type {
  ContentBlock,
  ParsedSession,
  Span,
  SpanType,
  ToolResultBlock,
  TranscriptEntry,
  TranscriptMessage,
} from '../types';

const METADATA_LIMIT = 10_000; // 10KB 截断，防 metadata 膨胀

function truncate(s: string): string {
  if (s.length <= METADATA_LIMIT) return s;
  return `${s.slice(0, METADATA_LIMIT)}…[truncated ${s.length - METADATA_LIMIT} chars]`;
}

function safeStringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return truncate(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

function toMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function asBlocks(msg?: TranscriptMessage): ContentBlock[] {
  if (!msg || !Array.isArray(msg.content)) return [];
  return (msg.content as unknown[]).filter(
    (b): b is ContentBlock => typeof b === 'object' && b !== null && 'type' in b,
  );
}

function asToolResults(msg?: TranscriptMessage): ToolResultBlock[] {
  if (!msg || !Array.isArray(msg.content)) return [];
  return (msg.content as unknown[]).filter(
    (b): b is ToolResultBlock =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result',
  );
}

interface MakeSpanInput {
  id: string;
  sessionId: string;
  parentId?: string | null;
  type: SpanType;
  name: string;
  startTime: number;
  endTime?: number;
  inputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  model?: string;
  stopReason?: string | null;
  isError?: boolean;
  isSidechain?: boolean;
  outputBytes?: number;
  metadata?: Record<string, unknown>;
}

function makeSpan(p: MakeSpanInput): Span {
  return {
    id: p.id,
    sessionId: p.sessionId,
    parentId: p.parentId ?? null,
    type: p.type,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    inputTokens: p.inputTokens || 0,
    cacheCreationTokens: p.cacheCreationTokens || 0,
    cacheReadTokens: p.cacheReadTokens || 0,
    outputTokens: p.outputTokens || 0,
    contextTokens: 0, // 由 analyzer 填（llm_turn）
    outputBytes: p.outputBytes || 0,
    model: p.model,
    cost: 0, // 由 analyzer 填
    costUnknown: false,
    stopReason: p.stopReason,
    isError: !!p.isError,
    isSidechain: !!p.isSidechain,
    metadata: p.metadata,
  };
}

export interface ParseOptions {
  filePath: string;
  agent?: string;
}

// 解析一个 transcript 的所有行 → sessionId + 元信息 + spans
// token 四类全部归到 llm_turn；thinking/tool_call/answer 的 token=0（含于父轮，不重复算）
export function parseTranscript(
  entries: TranscriptEntry[],
  opts: ParseOptions,
): ParsedSession | null {
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  // sessionId：取第一个非空（sessionId / session_id / uuid）；全空则跳过该文件
  let sid = '';
  for (const e of sorted) {
    sid = e.sessionId || e.session_id || e.uuid || '';
    if (sid) break;
  }
  if (!sid) return null;

  // 时间范围只取有 timestamp 的行（mode/permission-mode 等元数据行无 timestamp）
  const tsRows = sorted.filter((e) => e.timestamp);
  const startTime = tsRows.length ? toMs(tsRows[0].timestamp) : 0;
  const endTime = tsRows.length ? toMs(tsRows[tsRows.length - 1].timestamp) : undefined;
  // tool_result 配对索引：tool_use_id → { 结果行, result block }
  const toolResultMeta = new Map<
    string,
    { resultEntry: TranscriptEntry; block: ToolResultBlock }
  >();
  for (const e of sorted) {
    if (e.type === 'user' && e.message) {
      for (const r of asToolResults(e.message)) {
        toolResultMeta.set(r.tool_use_id, { resultEntry: e, block: r });
      }
    }
  }

  const spans: Span[] = [];
  let messageCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.type !== 'assistant' || !e.message) continue;
    messageCount++;

    const usage = e.message.usage;
    const inputTokens = usage?.input_tokens || 0;
    const cacheCreationTokens = usage?.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage?.cache_read_input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const model = e.message.model;
    const nextTs = findNextTimestamp(sorted, i + 1);

    // llm_turn span：承载四类 token + cost
    spans.push(
      makeSpan({
        id: e.uuid,
        sessionId: sid,
        parentId: e.parentUuid || null,
        type: 'llm_turn',
        name: model || 'llm',
        startTime: toMs(e.timestamp),
        endTime: nextTs,
        inputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        outputTokens,
        model,
        stopReason: e.message.stop_reason ?? null,
        isSidechain: e.isSidechain,
      }),
    );

    // 子 spans
    for (const b of asBlocks(e.message)) {
      if (b.type === 'thinking') {
        spans.push(
          makeSpan({
            id: `${e.uuid}-thinking`,
            sessionId: sid,
            parentId: e.uuid,
            type: 'thinking',
            name: 'thinking',
            startTime: toMs(e.timestamp),
            endTime: nextTs,
            isSidechain: e.isSidechain,
            metadata: {
              thinking: truncate(
                typeof b.thinking === 'string' ? b.thinking : safeStringify(b.thinking),
              ),
            },
          }),
        );
      } else if (b.type === 'tool_use') {
        const result = toolResultMeta.get(b.id);
        const resultTs = result ? toMs(result.resultEntry.timestamp) : undefined;
        const outputRaw = result ? result.block.content : undefined;
        const outputBytes =
          outputRaw != null ? Buffer.byteLength(safeStringify(outputRaw), 'utf8') : 0;
        spans.push(
          makeSpan({
            id: b.id,
            sessionId: sid,
            parentId: e.uuid,
            type: 'tool_call',
            name: b.name,
            startTime: toMs(e.timestamp),
            endTime: resultTs,
            isSidechain: e.isSidechain,
            isError: !!result?.block.is_error,
            outputBytes,
            metadata: {
              input: truncate(safeStringify(b.input)),
              output: outputRaw != null ? truncate(safeStringify(outputRaw)) : undefined,
            },
          }),
        );
      } else if (b.type === 'text') {
        spans.push(
          makeSpan({
            id: `${e.uuid}-text`,
            sessionId: sid,
            parentId: e.uuid,
            type: 'answer',
            name: 'answer',
            startTime: toMs(e.timestamp),
            endTime: nextTs,
            isSidechain: e.isSidechain,
            metadata: {
              text: truncate(typeof b.text === 'string' ? b.text : safeStringify(b.text)),
            },
          }),
        );
      }
    }
  }

  return {
    sessionId: sid,
    meta: {
      name: extractAiTitle(entries),
      filePath: opts.filePath,
      startTime,
      endTime,
      cwd: sorted[0].cwd,
      gitBranch: sorted[0].gitBranch,
      claudeVersion: sorted[0].version,
      messageCount,
      agent: opts.agent || 'unknown',
    },
    spans,
  };
}

function findNextTimestamp(sorted: TranscriptEntry[], fromIdx: number): number | undefined {
  for (let j = fromIdx; j < sorted.length; j++) {
    if (sorted[j].timestamp) return toMs(sorted[j].timestamp);
  }
  return undefined;
}

function extractAiTitle(entries: TranscriptEntry[]): string | undefined {
  for (const e of entries) {
    if (e.type === 'ai-title' && typeof e.aiTitle === 'string') return e.aiTitle;
  }
  return undefined;
}

import type { ParsedSession, Span, SpanType } from './types';

interface CodexEntry {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

const METADATA_LIMIT = 10_000;

function truncate(s: string): string {
  if (s.length <= METADATA_LIMIT) return s;
  return `${s.slice(0, METADATA_LIMIT)}…[truncated ${s.length - METADATA_LIMIT} chars]`;
}

function safeStringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return truncate(JSON.stringify(v)); } catch { return String(v); }
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function makeSpan(p: {
  id: string; sessionId: string; parentId?: string | null; type: SpanType;
  name: string; startTime: number; endTime?: number;
  inputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number;
  outputTokens?: number; model?: string; isError?: boolean; isSidechain?: boolean;
  outputBytes?: number; metadata?: Record<string, unknown>;
}): Span {
  return {
    id: p.id, sessionId: p.sessionId, parentId: p.parentId ?? null,
    type: p.type, name: p.name, startTime: p.startTime, endTime: p.endTime,
    inputTokens: p.inputTokens || 0, cacheCreationTokens: p.cacheCreationTokens || 0,
    cacheReadTokens: p.cacheReadTokens || 0, outputTokens: p.outputTokens || 0,
    contextTokens: 0, outputBytes: p.outputBytes || 0, model: p.model,
    cost: 0, costUnknown: false, isError: !!p.isError, isSidechain: !!p.isSidechain,
    metadata: p.metadata,
  };
}

export interface CodexParseOptions {
  filePath: string;
}

// 解析 Codex rollout JSONL → ParsedSession
export function parseCodexTranscript(
  entries: CodexEntry[],
  opts: CodexParseOptions,
): ParsedSession | null {
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) =>
    (a.timestamp || '').localeCompare(b.timestamp || ''),
  );

  // 1. 提取 session_meta
  const meta = sorted.find((e) => e.type === 'session_meta')?.payload;
  if (!meta?.session_id) return null;

  const sessionId = meta.session_id as string;
  const cwd = meta.cwd as string | undefined;
  const claudeVersion = meta.cli_version as string | undefined;
  const model = meta.model_provider as string | undefined;

  // 2. 收集 reasoning 文本构建 session name
  const allReasoningTexts: string[] = [];
  for (const e of sorted) {
    if (e.type === 'event_msg' && e.payload.type === 'agent_reasoning') {
      const t = e.payload.text as string;
      if (t) allReasoningTexts.push(t);
    }
  }
  const name = allReasoningTexts.length > 0
    ? allReasoningTexts[0].replace(/^\*\*/, '').replace(/\*\*$/, '').slice(0, 80)
    : undefined;

  // 3. 构建 call_id → tool_call_output 映射
  const toolOutputs = new Map<string, { entry: CodexEntry; output: unknown; isError: boolean }>();
  for (const e of sorted) {
    if (e.type === 'response_item' && e.payload.type === 'custom_tool_call_output') {
      const callId = e.payload.call_id as string;
      const output = e.payload.output;
      const isError = !!e.payload.is_error;
      toolOutputs.set(callId, { entry: e, output, isError });
    }
  }

  // 4. 按 turn_context 分组
  const turns: CodexEntry[][] = [];
  let currentTurn: CodexEntry[] = [];

  for (const e of sorted) {
    if ((e.type === 'turn_context' || e.type === 'event_msg' && e.payload.type === 'task_started') && currentTurn.length > 0) {
      // 新的 turn 开始前，保存当前 turn
      // 仅当有实际内容时才保存（排除孤立的 turn_context）
      const hasContent = currentTurn.some(
        (x) =>
          (x.type === 'response_item' && (x.payload.type === 'reasoning' || x.payload.type === 'custom_tool_call')) ||
          (x.type === 'event_msg' && x.payload.type === 'token_count'),
      );
      if (hasContent) turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(e);
  }
  // 最后一个 turn
  if (currentTurn.length > 0) {
    const hasContent = currentTurn.some(
      (x) =>
        (x.type === 'response_item' && (x.payload.type === 'reasoning' || x.payload.type === 'custom_tool_call')) ||
        (x.type === 'event_msg' && x.payload.type === 'token_count'),
    );
    if (hasContent) turns.push(currentTurn);
  }

  // 5. 每个 turn → spans
  const spans: Span[] = [];
  const tsRows = sorted.filter((e) => e.timestamp);
  const sessionStart = tsRows.length ? toMs(tsRows[0].timestamp) : 0;
  const sessionEnd = tsRows.length ? toMs(tsRows[tsRows.length - 1].timestamp) : undefined;

  for (const turnEntries of turns) {
    const firstTs = turnEntries.find((e) => e.timestamp)?.timestamp;
    const lastTs = [...turnEntries].reverse().find((e) => e.timestamp)?.timestamp;
    const turnStart = firstTs ? toMs(firstTs) : 0;
    const turnEnd = lastTs ? toMs(lastTs) : undefined;

    // 找到 turn_id
    const turnContext = turnEntries.find(
      (e) => e.type === 'turn_context',
    );
    const turnId = (turnContext?.payload.turn_id as string) || `turn-${turnStart}`;

    // token 取该 turn 内最后一个 token_count 的 last_token_usage
    let inputTokens = 0, cacheReadTokens = 0, outputTokens = 0;
    for (let i = turnEntries.length - 1; i >= 0; i--) {
      const e = turnEntries[i];
      if (e.type === 'event_msg' && e.payload.type === 'token_count') {
        const lastUsage = (e.payload.info as Record<string, unknown>)?.last_token_usage as
          | Record<string, number>
          | undefined;
        if (lastUsage) {
          inputTokens = lastUsage.input_tokens || 0;
          cacheReadTokens = lastUsage.cached_input_tokens || 0;
          outputTokens = (lastUsage.output_tokens || 0) + (lastUsage.reasoning_output_tokens || 0);
        }
        break;
      }
    }

    // llm_turn span
    spans.push(
      makeSpan({
        id: turnId,
        sessionId,
        type: 'llm_turn',
        name: model || 'codex',
        startTime: turnStart,
        endTime: turnEnd,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        model,
      }),
    );

    // reasoning → thinking spans
    for (const e of turnEntries) {
      if (e.type === 'response_item' && e.payload.type === 'reasoning') {
        const content = e.payload.content as Array<{ type: string; text?: string }> | undefined;
        const text = content
          ?.filter((c) => c.type === 'input_text')
          .map((c) => c.text || '')
          .join('\n');
        if (text) {
          spans.push(
            makeSpan({
              id: `${turnId}-reasoning-${spans.length}`,
              sessionId,
              parentId: turnId,
              type: 'thinking',
              name: 'reasoning',
              startTime: turnStart,
              endTime: turnEnd,
              metadata: { thinking: truncate(text) },
            }),
          );
        }
      }
    }

    // event_msg|agent_reasoning → thinking spans
    for (const e of turnEntries) {
      if (e.type === 'event_msg' && e.payload.type === 'agent_reasoning') {
        const text = e.payload.text as string;
        if (text) {
          spans.push(
            makeSpan({
              id: `${turnId}-agent-reasoning-${spans.length}`,
              sessionId,
              parentId: turnId,
              type: 'thinking',
              name: 'agent_reasoning',
              startTime: turnStart,
              endTime: turnEnd,
              metadata: { thinking: truncate(text) },
            }),
          );
        }
      }
    }

    // custom_tool_call + output → tool_call spans
    for (const e of turnEntries) {
      if (e.type === 'response_item' && e.payload.type === 'custom_tool_call') {
        const callId = e.payload.call_id as string;
        const toolName = (e.payload.name as string) || 'unknown';
        const input = e.payload.input;
        const result = toolOutputs.get(callId);
        const outputRaw = result?.output;
        const outputBytes = outputRaw != null ? Buffer.byteLength(safeStringify(outputRaw), 'utf8') : 0;

        spans.push(
          makeSpan({
            id: callId || `${turnId}-tool-${spans.length}`,
            sessionId,
            parentId: turnId,
            type: 'tool_call',
            name: toolName,
            startTime: turnStart,
            endTime: result ? toMs(result.entry.timestamp) : turnEnd,
            isError: result?.isError,
            outputBytes,
            metadata: {
              input: input != null ? truncate(safeStringify(input)) : undefined,
              output: outputRaw != null ? truncate(safeStringify(outputRaw)) : undefined,
            },
          }),
        );
      }
    }
  }

  return {
    sessionId,
    meta: {
      name,
      filePath: opts.filePath,
      startTime: sessionStart,
      endTime: sessionEnd,
      cwd,
      gitBranch: undefined,
      claudeVersion,
      messageCount: turns.length,
      agent: 'codex',
    },
    spans,
  };
}

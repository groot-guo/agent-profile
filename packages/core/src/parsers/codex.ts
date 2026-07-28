import type { ParsedSession, Span, SpanType } from '../types';

export interface CodexEntry {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

export function nonActionableCodexExternalHistoryId(entries: CodexEntry[]): string | undefined {
  const meta = entries.find((entry) => entry.type === 'session_meta')?.payload;
  const sessionId =
    typeof meta?.id === 'string'
      ? meta.id
      : typeof meta?.session_id === 'string'
        ? meta.session_id
        : undefined;
  if (
    !sessionId ||
    meta?.source !== 'vscode' ||
    meta?.originator !== 'Codex Desktop' ||
    entries.some((entry) => entry.type === 'turn_context')
  ) {
    return undefined;
  }
  return entries.some(
    (entry) =>
      entry.type === 'event_msg' &&
      entry.payload?.type === 'task_started' &&
      typeof entry.payload.turn_id === 'string' &&
      entry.payload.turn_id.startsWith('external-import-turn-'),
  )
    ? sessionId
    : undefined;
}

const METADATA_LIMIT = 10_000;

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

function toCapturedMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value >= 1_000_000_000_000 ? value : value * 1_000;
}

function messageText(entry: CodexEntry): string {
  if (entry.type !== 'response_item' || entry.payload?.type !== 'message') return '';
  if (!Array.isArray(entry.payload.content)) return '';
  return (entry.payload.content as unknown[])
    .filter(
      (item): item is { text: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { text?: unknown }).text === 'string',
    )
    .map((item) => item.text)
    .join('\n');
}

function isMessage(entry: CodexEntry, role: 'user' | 'assistant'): boolean {
  return (
    entry.type === 'response_item' &&
    entry.payload?.type === 'message' &&
    entry.payload.role === role
  );
}

function isEmbeddedToolTranscript(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('[external_agent_tool_call:') ||
    trimmed.startsWith('[external_agent_tool_result]')
  );
}

function makeSpan(p: {
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
  isError?: boolean;
  isSidechain?: boolean;
  outputBytes?: number;
  metadata?: Record<string, unknown>;
}): Span {
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
    contextTokens: 0,
    outputBytes: p.outputBytes || 0,
    model: p.model,
    cost: 0,
    costUnknown: false,
    isError: !!p.isError,
    isSidechain: !!p.isSidechain,
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
  if (nonActionableCodexExternalHistoryId(entries)) return null;

  // Array.sort is stable in supported runtimes, but retain the source index as
  // an explicit tie-breaker because migrated VS Code histories batch many
  // original events under the same rollout timestamp.
  const sorted = entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .sort(
      (a, b) =>
        (a.entry.timestamp || '').localeCompare(b.entry.timestamp || '') ||
        a.sourceIndex - b.sourceIndex,
    )
    .map(({ entry }) => entry);

  // 1. 提取 session_meta
  const meta = sorted.find((e) => e.type === 'session_meta')?.payload;
  if (!meta) return null;
  const sessionId =
    typeof meta.id === 'string'
      ? meta.id
      : typeof meta.session_id === 'string'
        ? meta.session_id
        : undefined;
  if (!sessionId) return null;

  const hasTurnContexts = sorted.some((entry) => entry.type === 'turn_context');
  const cwd = meta.cwd as string | undefined;
  const claudeVersion = meta.cli_version as string | undefined;
  const isSidechain = typeof meta.parent_thread_id === 'string' && meta.parent_thread_id.length > 0;

  // 2. 收集 reasoning 文本构建 session name
  const allReasoningTexts: string[] = [];
  for (const e of sorted) {
    if (e.type === 'event_msg' && e.payload && e.payload.type === 'agent_reasoning') {
      const t = e.payload.text as string;
      if (t) allReasoningTexts.push(t);
    }
  }
  const name =
    allReasoningTexts.length > 0
      ? allReasoningTexts[0].replace(/^\*\*/, '').replace(/\*\*$/, '').slice(0, 80)
      : undefined;

  // 3. 构建 call_id → tool_call_output 映射
  const toolOutputs = new Map<string, { entry: CodexEntry; output: unknown; isError: boolean }>();
  for (const e of sorted) {
    if (e.type === 'response_item' && e.payload && e.payload.type === 'custom_tool_call_output') {
      const callId = e.payload.call_id as string;
      const output = e.payload.output;
      const isError = !!e.payload.is_error;
      toolOutputs.set(callId, { entry: e, output, isError });
    }
  }

  // 4. 按 turn_context / task_started 分组。迁移历史没有 turn_context，
  // 因此 user message 也必须算作回合证据；现代 rollout 的上下文快照里
  // 会重复 user message，不能把它误建成额外回合。
  const turns: CodexEntry[][] = [];
  let currentTurn: CodexEntry[] = [];
  const hasTurnContent = (turnEntries: CodexEntry[]): boolean =>
    turnEntries.some(
      (entry) =>
        (entry.type === 'response_item' &&
          entry.payload &&
          (entry.payload.type === 'reasoning' ||
            entry.payload.type === 'custom_tool_call' ||
            (isMessage(entry, 'assistant') && messageText(entry).length > 0) ||
            (!hasTurnContexts && isMessage(entry, 'user') && messageText(entry).length > 0))) ||
        (entry.type === 'event_msg' && entry.payload && entry.payload.type === 'token_count'),
    );

  for (const e of sorted) {
    if (
      (e.type === 'turn_context' ||
        (e.type === 'event_msg' && e.payload && e.payload.type === 'task_started')) &&
      currentTurn.length > 0
    ) {
      // 新的 turn 开始前，保存当前 turn
      // 仅当有实际内容时才保存（排除孤立的 turn_context）
      if (hasTurnContent(currentTurn)) turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(e);
  }
  // 最后一个 turn
  if (currentTurn.length > 0) {
    if (hasTurnContent(currentTurn)) turns.push(currentTurn);
  }

  // 5. 每个 turn → spans
  const spans: Span[] = [];
  const tsRows = sorted.filter((e) => e.timestamp);
  const capturedTaskStarts = !hasTurnContexts
    ? sorted
        .filter((entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_started')
        .map((entry) => toCapturedMs(entry.payload.started_at))
        .filter((value): value is number => value !== undefined)
    : [];
  const capturedTaskEnds = !hasTurnContexts
    ? sorted
        .filter((entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_complete')
        .map((entry) => toCapturedMs(entry.payload.completed_at))
        .filter((value): value is number => value !== undefined)
    : [];
  const sessionStart = capturedTaskStarts.length
    ? Math.min(...capturedTaskStarts)
    : tsRows.length
      ? toMs(tsRows[0].timestamp)
      : 0;
  const sessionEnd = capturedTaskStarts.length
    ? Math.max(...capturedTaskStarts, ...capturedTaskEnds)
    : tsRows.length
      ? toMs(tsRows[tsRows.length - 1].timestamp)
      : undefined;

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turnEntries = turns[turnIndex];
    const firstTs = turnEntries.find((e) => e.timestamp)?.timestamp;
    const lastTs = [...turnEntries].reverse().find((e) => e.timestamp)?.timestamp;
    const taskStarted = turnEntries.find(
      (entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_started',
    );
    const taskComplete = [...turnEntries]
      .reverse()
      .find((entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_complete');
    const capturedTurnStart = !hasTurnContexts
      ? toCapturedMs(taskStarted?.payload.started_at)
      : undefined;
    const nextTaskStarted = !hasTurnContexts
      ? turns[turnIndex + 1]?.find(
          (entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_started',
        )
      : undefined;
    const capturedTurnEnd = !hasTurnContexts
      ? (toCapturedMs(taskComplete?.payload.completed_at) ??
        toCapturedMs(nextTaskStarted?.payload.started_at) ??
        capturedTurnStart)
      : undefined;
    const turnStart = capturedTurnStart ?? (firstTs ? toMs(firstTs) : 0);
    const turnEnd = capturedTurnEnd ?? (lastTs ? toMs(lastTs) : undefined);

    // 找到 turn_id
    const turnContext = turnEntries.find((e) => e.type === 'turn_context');
    const capturedModel = turnContext?.payload.model;
    const model =
      typeof capturedModel === 'string' && capturedModel.trim() ? capturedModel.trim() : undefined;
    const turnId =
      (turnContext?.payload.turn_id as string) ||
      (taskStarted?.payload.turn_id as string) ||
      `turn-${turnIndex + 1}-${turnStart}`;

    // token 取该 turn 内最后一个 token_count 的 last_token_usage
    let inputTokens = 0,
      cacheReadTokens = 0,
      outputTokens = 0;
    let tokenUsageFallback = false;
    for (let i = turnEntries.length - 1; i >= 0; i--) {
      const e = turnEntries[i];
      if (e.type === 'event_msg' && e.payload && e.payload.type === 'token_count') {
        const lastUsage = (e.payload.info as Record<string, unknown>)?.last_token_usage as
          | Record<string, number>
          | undefined;
        if (lastUsage) {
          inputTokens = lastUsage.input_tokens || 0;
          cacheReadTokens = lastUsage.cached_input_tokens || 0;
          outputTokens = (lastUsage.output_tokens || 0) + (lastUsage.reasoning_output_tokens || 0);
          // codex 某些 turn 的分类 token 全 0 但 total_tokens 有值（未分类的累计量），
          // 回退到 total 作为 input，避免该 turn 被记成零 token
          if (
            inputTokens === 0 &&
            cacheReadTokens === 0 &&
            outputTokens === 0 &&
            lastUsage.total_tokens
          ) {
            inputTokens = lastUsage.total_tokens;
            tokenUsageFallback = true;
          }
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
        isSidechain,
        metadata: tokenUsageFallback
          ? { tokenUsageSource: 'total_tokens_fallback', tokenUsageClassified: false }
          : undefined,
      }),
    );

    // reasoning → thinking spans
    for (const e of turnEntries) {
      if (e.type === 'response_item' && e.payload && e.payload.type === 'reasoning') {
        const content = Array.isArray(e.payload.content)
          ? (e.payload.content as Array<{ type: string; text?: string }>)
          : undefined;
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
              isSidechain,
              metadata: { thinking: truncate(text) },
            }),
          );
        }
      }
    }

    // event_msg|agent_reasoning → thinking spans
    for (const e of turnEntries) {
      if (e.type === 'event_msg' && e.payload && e.payload.type === 'agent_reasoning') {
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
              isSidechain,
              metadata: { thinking: truncate(text) },
            }),
          );
        }
      }
    }

    // response_item|message assistant → answer spans. event_msg|agent_message
    // intentionally remains ignored because migrated histories duplicate the
    // same assistant content in both forms. Text-wrapped historical tool calls
    // are not structural tool evidence and are omitted from answer spans.
    for (let entryIndex = 0; entryIndex < turnEntries.length; entryIndex++) {
      const entry = turnEntries[entryIndex];
      if (!isMessage(entry, 'assistant')) continue;
      const text = messageText(entry);
      if (!text || isEmbeddedToolTranscript(text)) continue;
      spans.push(
        makeSpan({
          id: `${turnId}-answer-${entryIndex}`,
          sessionId,
          parentId: turnId,
          type: 'answer',
          name: 'answer',
          startTime: turnStart,
          endTime: turnEnd,
          isSidechain,
          metadata: { text: truncate(text) },
        }),
      );
    }

    // custom_tool_call + output → tool_call spans
    for (const e of turnEntries) {
      if (e.type === 'response_item' && e.payload && e.payload.type === 'custom_tool_call') {
        const callId = e.payload.call_id as string;
        const toolName = (e.payload.name as string) || 'unknown';
        const input = e.payload.input;
        const result = toolOutputs.get(callId);
        const outputRaw = result?.output;
        const outputBytes =
          outputRaw != null ? Buffer.byteLength(safeStringify(outputRaw), 'utf8') : 0;

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
            isSidechain,
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

  if (spans.length === 0) return null;
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

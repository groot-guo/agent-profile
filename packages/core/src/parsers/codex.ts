import type {
  ParsedSession,
  SourceCallbackStatus,
  SourceChildLineage,
  Span,
  SpanType,
} from '../types';
import { isCrossSessionSpan } from '../types';

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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function capturedEntryTime(entry: CodexEntry): number | undefined {
  const payloadTime = toCapturedMs(entry.payload.occurred_at_ms);
  if (payloadTime !== undefined) return payloadTime;
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) ? timestamp : undefined;
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

function callbackStatus(payload: Record<string, unknown>): SourceCallbackStatus {
  if (payload.phase === 'final_answer') return 'final_answer';
  const text = [
    typeof payload.message === 'string' ? payload.message : undefined,
    ...(Array.isArray(payload.content)
      ? payload.content.map((item) => {
          if (typeof item === 'string') return item;
          if (
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { text?: unknown }).text === 'string'
          ) {
            return (item as { text: string }).text;
          }
          return undefined;
        })
      : []),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n');
  return /(?:^|\n)Message Type:\s*FINAL_ANSWER\b/.test(text) ? 'final_answer' : 'observed';
}

function sourceChildLineage(
  entries: CodexEntry[],
  sourceChildMetadata: Record<string, CodexAgentMetadata> | undefined,
): SourceChildLineage[] {
  const lineageByChildId = new Map<string, SourceChildLineage>();
  const childIdsByAgentPath = new Map<string, Set<string>>();
  const registerPath = (childSessionId: string, agentPath: string | undefined): void => {
    if (!agentPath) return;
    const childIds = childIdsByAgentPath.get(agentPath) ?? new Set<string>();
    childIds.add(childSessionId);
    childIdsByAgentPath.set(agentPath, childIds);
  };

  for (const [childSessionId, metadata] of Object.entries(sourceChildMetadata ?? {})) {
    const agentPath = nonEmptyString(metadata.agentPath);
    lineageByChildId.set(childSessionId, {
      childSessionId,
      agentNickname: nonEmptyString(metadata.agentNickname),
      agentRole: nonEmptyString(metadata.agentRole),
      agentPath,
    });
    registerPath(childSessionId, agentPath);
  }

  for (const entry of entries) {
    const payload = entry.payload;
    const isSubAgentActivity = entry.type === 'event_msg' && payload.type === 'sub_agent_activity';
    if (!isSubAgentActivity || (payload.kind !== 'started' && payload.kind !== 'interacted')) {
      continue;
    }
    const childSessionId = nonEmptyString(payload.agent_thread_id);
    if (!childSessionId) continue;
    const metadata = sourceChildMetadata?.[childSessionId];
    const existing = lineageByChildId.get(childSessionId);
    const agentPath = nonEmptyString(metadata?.agentPath) ?? nonEmptyString(payload.agent_path);
    const capturedAt = capturedEntryTime(entry);
    lineageByChildId.set(childSessionId, {
      childSessionId,
      agentNickname: nonEmptyString(metadata?.agentNickname) ?? existing?.agentNickname,
      agentRole: nonEmptyString(metadata?.agentRole) ?? existing?.agentRole,
      agentPath,
      callStartedAt:
        payload.kind === 'started'
          ? (capturedAt ?? existing?.callStartedAt)
          : existing?.callStartedAt,
      callbackAt:
        payload.kind === 'interacted' && capturedAt !== undefined
          ? Math.max(existing?.callbackAt ?? capturedAt, capturedAt)
          : existing?.callbackAt,
      callbackStatus:
        payload.kind === 'interacted' || existing?.callbackStatus === 'final_answer'
          ? existing?.callbackStatus === 'final_answer'
            ? 'final_answer'
            : 'observed'
          : existing?.callbackStatus,
    });
    registerPath(childSessionId, agentPath);
  }

  for (const entry of entries) {
    const payload = entry.payload;
    const isAgentMessage =
      (entry.type === 'response_item' || entry.type === 'event_msg') &&
      payload.type === 'agent_message';
    if (!isAgentMessage) continue;
    const directChildId =
      nonEmptyString(payload.agent_thread_id) ?? nonEmptyString(payload.child_thread_id);
    const authorPath = nonEmptyString(payload.author) ?? nonEmptyString(payload.agent_path);
    const childIds = directChildId
      ? lineageByChildId.has(directChildId)
        ? [directChildId]
        : []
      : authorPath
        ? [...(childIdsByAgentPath.get(authorPath) ?? [])]
        : [];
    if (childIds.length !== 1) continue;
    const childSessionId = childIds[0];
    const existing = lineageByChildId.get(childSessionId);
    if (!existing) continue;
    const observedAt = capturedEntryTime(entry);
    const observedStatus = callbackStatus(payload);
    lineageByChildId.set(childSessionId, {
      ...existing,
      callbackAt:
        observedAt === undefined
          ? existing.callbackAt
          : Math.max(existing.callbackAt ?? observedAt, observedAt),
      callbackStatus:
        observedStatus === 'final_answer' || existing.callbackStatus === 'final_answer'
          ? 'final_answer'
          : 'observed',
    });
  }

  return [...lineageByChildId.values()].sort((a, b) =>
    a.childSessionId.localeCompare(b.childSessionId),
  );
}

type CodexOwnershipStatus =
  | 'cross_session'
  | 'source_user'
  | 'corrupted_ownership'
  | 'not_captured';

function scopedCodexSpanId(sessionId: string, sourceId: string): string {
  return `codex:${sessionId}:${sourceId}`;
}

function turnIdentity(entries: CodexEntry[]): string | undefined {
  const turnContext = entries.find((entry) => entry.type === 'turn_context');
  const contextTurnId = nonEmptyString(turnContext?.payload.turn_id);
  if (contextTurnId) return contextTurnId;
  const passthroughTurnId = entries
    .filter((entry) => entry.type === 'response_item' && entry.payload?.type === 'message')
    .map(
      (entry) =>
        (entry.payload as Record<string, unknown>)?.internal_chat_message_metadata_passthrough as
          | { turn_id?: unknown }
          | undefined,
    )
    .map((metadata) => nonEmptyString(metadata?.turn_id))
    .find((value): value is string => value !== undefined);
  if (passthroughTurnId) return passthroughTurnId;
  const taskTurnId = entries.find(
    (entry) => entry.type === 'event_msg' && entry.payload?.type === 'task_started',
  )?.payload.turn_id;
  return nonEmptyString(taskTurnId);
}

function mergeTurnBuckets(turns: CodexEntry[][]): CodexEntry[][] {
  const merged: CodexEntry[][] = [];
  for (const turn of turns) {
    const previous = merged.at(-1);
    const turnId = turnIdentity(turn);
    if (previous && turnId && turnIdentity(previous) === turnId) {
      previous.push(...turn);
    } else {
      merged.push([...turn]);
    }
  }
  return merged;
}

function inheritedTurnIds(
  entries: CodexEntry[],
  sessionId: string,
  sourceParentSessionId: string | undefined,
): Set<string> {
  if (!sourceParentSessionId) return new Set();
  const parentMetaIndex = entries.findIndex((entry, index) => {
    if (index === 0 || entry.type !== 'session_meta') return false;
    const id = nonEmptyString(entry.payload.id) ?? nonEmptyString(entry.payload.session_id);
    return id === sourceParentSessionId && id !== sessionId;
  });
  if (parentMetaIndex < 0) return new Set();
  const firstBoundaryIndex = entries.findIndex(
    (entry, index) =>
      index > parentMetaIndex &&
      (entry.type === 'turn_context' ||
        (entry.type === 'event_msg' && entry.payload?.type === 'task_started')),
  );
  if (firstBoundaryIndex < 0) return new Set();

  const turnIds = new Set<string>();
  const addTurnId = (entry: CodexEntry): void => {
    if (entry.type !== 'turn_context' && entry.type !== 'event_msg') return;
    const turnId = nonEmptyString(entry.payload.turn_id);
    if (turnId) turnIds.add(turnId);
  };
  addTurnId(entries[firstBoundaryIndex]);

  // The copied parent context starts at its first boundary and ends when the
  // child starts its own live turn. Parent snapshots can contain many
  // turn_context records, so keep the complete range instead of only the first
  // turn ID. The first task_started belongs to the copied parent boundary;
  // the next one is the child boundary in the rollout format.
  const childBoundaryIndex = entries.findIndex(
    (entry, index) =>
      index > firstBoundaryIndex &&
      entry.type === 'event_msg' &&
      entry.payload?.type === 'task_started',
  );
  if (childBoundaryIndex >= 0) {
    for (const entry of entries.slice(firstBoundaryIndex, childBoundaryIndex)) addTurnId(entry);
    return turnIds;
  }

  // Without an explicit child task_started, only extend the inherited range
  // across turn_context boundaries that have another copied parent session_meta
  // before them. A later context without that marker is the live child turn.
  let previousBoundaryIndex = firstBoundaryIndex;
  let previousTurnId = nonEmptyString(entries[firstBoundaryIndex].payload.turn_id);
  for (let index = firstBoundaryIndex + 1; index < entries.length; index++) {
    const entry = entries[index];
    if (
      entry.type !== 'turn_context' &&
      !(entry.type === 'event_msg' && entry.payload?.type === 'task_started')
    ) {
      continue;
    }
    const turnId = nonEmptyString(entry.payload.turn_id);
    const hasCopiedParentMeta = entries
      .slice(previousBoundaryIndex + 1, index)
      .some((candidate) => {
        if (candidate.type !== 'session_meta') return false;
        const id =
          nonEmptyString(candidate.payload.id) ?? nonEmptyString(candidate.payload.session_id);
        return id === sourceParentSessionId && id !== sessionId;
      });
    if (!turnId || (!hasCopiedParentMeta && turnId !== previousTurnId)) break;
    addTurnId(entry);
    previousBoundaryIndex = index;
    previousTurnId = turnId;
  }
  return turnIds;
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
  ownershipStatus?: CodexOwnershipStatus;
  sourceSessionId?: string;
}): Span {
  const metadata =
    p.ownershipStatus || p.sourceSessionId
      ? {
          ...p.metadata,
          ...(p.ownershipStatus ? { ownershipStatus: p.ownershipStatus } : {}),
          ...(p.sourceSessionId ? { sourceSessionId: p.sourceSessionId } : {}),
        }
      : p.metadata;
  return {
    id: scopedCodexSpanId(p.sessionId, p.id),
    sessionId: p.sessionId,
    parentId: p.parentId ? scopedCodexSpanId(p.sessionId, p.parentId) : null,
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
    costStatus: 'unknown_pricing',
    isError: !!p.isError,
    isSidechain: !!p.isSidechain,
    metadata,
  };
}

export interface CodexParseOptions {
  filePath: string;
  sessionId?: string;
  cwd?: string;
  claudeVersion?: string;
  sourceParentSessionId?: string;
  sourceTitle?: string;
  sourceAgentNickname?: string;
  sourceAgentRole?: string;
  sourceAgentPath?: string;
  sourceChildMetadata?: Record<string, CodexAgentMetadata>;
}

export interface CodexAgentMetadata {
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
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
  const meta = sorted.find((e) => e.type === 'session_meta')?.payload ?? {};
  const sessionId =
    typeof meta.id === 'string'
      ? meta.id
      : typeof meta.session_id === 'string'
        ? meta.session_id
        : opts.sessionId;
  if (!sessionId) return null;

  const hasTurnContexts = sorted.some((entry) => entry.type === 'turn_context');
  const cwd = (meta.cwd as string | undefined) ?? opts.cwd;
  const claudeVersion = (meta.cli_version as string | undefined) ?? opts.claudeVersion;
  const sourceParentSessionId =
    typeof meta.parent_thread_id === 'string' &&
    meta.parent_thread_id.trim() &&
    meta.parent_thread_id !== sessionId
      ? meta.parent_thread_id
      : opts.sourceParentSessionId;
  const isSidechain = sourceParentSessionId !== undefined;

  // Codex rollout does not carry a trustworthy thread title. Only the state
  // database title is accepted; reasoning is process evidence, not identity.
  const name = nonEmptyString(opts.sourceTitle);
  const childLineage = sourceChildLineage(sorted, opts.sourceChildMetadata);

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
  let turns: CodexEntry[][] = [];
  const isolatedTurnContexts: CodexEntry[] = [];
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
      if (hasTurnContent(currentTurn)) {
        turns.push(currentTurn);
      } else if (
        currentTurn.every((entry) => entry.type === 'turn_context') &&
        currentTurn[0]?.payload?.model
      ) {
        // 一个只含 turn_context（带 model）的桶是 source evidence：LLM 回合
        // 已开始但没有任何 token/内容遥测被捕获。保留为 stub turn，而不是
        // 假装该回合不存在或用量为零。
        isolatedTurnContexts.push(currentTurn[0]);
      }
      currentTurn = [];
    }
    currentTurn.push(e);
  }
  // 最后一个 turn
  if (currentTurn.length > 0) {
    if (hasTurnContent(currentTurn)) turns.push(currentTurn);
    else if (
      currentTurn.every((entry) => entry.type === 'turn_context') &&
      currentTurn[0]?.payload?.model
    ) {
      isolatedTurnContexts.push(currentTurn[0]);
    }
  }
  turns = mergeTurnBuckets(turns);

  // 5. 计算 session 时间范围
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

  const spans: Span[] = [];
  const inheritedIds = inheritedTurnIds(sorted, sessionId, sourceParentSessionId);

  // 6. 把孤立 turn_context 转成 stub llm_turn spans（无 token 遥测）。
  for (const context of isolatedTurnContexts) {
    const turnId = (context.payload.turn_id as string) || `turn-stub-${context.timestamp}`;
    const inherited = inheritedIds.has(turnId);
    const model =
      !inherited && typeof context.payload.model === 'string' ? context.payload.model : undefined;
    const startTime = context.timestamp ? toMs(context.timestamp) : sessionStart;
    spans.push(
      makeSpan({
        id: turnId,
        sessionId,
        type: 'llm_turn',
        name: model || 'codex',
        startTime,
        endTime: startTime,
        model,
        isSidechain,
        ...(inherited
          ? { ownershipStatus: 'cross_session' as const, sourceSessionId: sourceParentSessionId }
          : {}),
        metadata: {
          tokenUsageSource: 'not_captured',
          tokenUsageClassified: false,
          stubTurn: true,
        },
      }),
    );
  }

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
    // 迁移历史（无 turn_context）中，assistant/user 消息通过
    // internal_chat_message_metadata_passthrough.turn_id 标注真实 LLM turn；
    // task_started 命名的可能是进程 turn（如 review mode），不能作为消息归属。
    const turnId = turnIdentity(turnEntries) ?? `turn-${turnIndex + 1}-${turnStart}`;
    const inherited = inheritedIds.has(turnId);

    // token 取该 turn 内最后一个 token_count 的 last_token_usage
    let inputTokens = 0,
      cacheReadTokens = 0,
      outputTokens = 0;
    let tokenUsageFallback = false;
    let tokenUsageCaptured = false;
    for (let i = turnEntries.length - 1; i >= 0 && !inherited; i--) {
      const e = turnEntries[i];
      if (e.type === 'event_msg' && e.payload && e.payload.type === 'token_count') {
        const lastUsage = (e.payload.info as Record<string, unknown>)?.last_token_usage as
          | Record<string, number>
          | undefined;
        if (lastUsage) {
          tokenUsageCaptured = true;
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
        name: inherited ? 'codex (cross-session context)' : model || 'codex',
        startTime: turnStart,
        endTime: turnEnd,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        model: inherited ? undefined : model,
        isSidechain,
        ...(inherited
          ? { ownershipStatus: 'cross_session' as const, sourceSessionId: sourceParentSessionId }
          : {}),
        metadata: tokenUsageFallback
          ? { tokenUsageSource: 'total_tokens_fallback', tokenUsageClassified: false }
          : tokenUsageCaptured
            ? { tokenUsageSource: 'token_count', tokenUsageClassified: true }
            : {
                tokenUsageSource: 'not_captured',
                tokenUsageClassified: false,
                stubTurn: hasTurnContent(turnEntries) === false,
              },
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
              ...(inherited
                ? {
                    ownershipStatus: 'cross_session' as const,
                    sourceSessionId: sourceParentSessionId,
                  }
                : {}),
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
              ...(inherited
                ? {
                    ownershipStatus: 'cross_session' as const,
                    sourceSessionId: sourceParentSessionId,
                  }
                : {}),
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
          ...(inherited
            ? {
                ownershipStatus: 'cross_session' as const,
                sourceSessionId: sourceParentSessionId,
              }
            : {}),
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
            ...(inherited
              ? {
                  ownershipStatus: 'cross_session' as const,
                  sourceSessionId: sourceParentSessionId,
                }
              : {}),
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
      sourceParentSessionId,
      sourceAgentNickname: nonEmptyString(opts.sourceAgentNickname),
      sourceAgentRole: nonEmptyString(opts.sourceAgentRole),
      sourceAgentPath: nonEmptyString(opts.sourceAgentPath),
      sourceChildLineage: childLineage.length > 0 ? childLineage : undefined,
      messageCount: spans.filter((span) => span.type === 'llm_turn' && !isCrossSessionSpan(span))
        .length,
      agent: 'codex',
    },
    spans,
  };
}

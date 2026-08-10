import type { ParsedSession, Span, SpanType } from '../types';

const METADATA_LIMIT = 10_000;

function truncate(value: string): string {
  if (value.length <= METADATA_LIMIT) return value;
  return `${value.slice(0, METADATA_LIMIT)}…[truncated ${value.length - METADATA_LIMIT} chars]`;
}

function safeStringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function makeSpan(input: {
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
  outputBytes?: number;
  metadata?: Record<string, unknown>;
}): Span {
  return {
    id: input.id,
    sessionId: input.sessionId,
    parentId: input.parentId ?? null,
    type: input.type,
    name: input.name,
    startTime: input.startTime,
    endTime: input.endTime,
    inputTokens: input.inputTokens ?? 0,
    cacheCreationTokens: input.cacheCreationTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    contextTokens: 0,
    outputBytes: input.outputBytes ?? 0,
    model: input.model,
    cost: 0,
    costUnknown: false,
    costStatus: 'unknown_pricing',
    isError: input.isError ?? false,
    isSidechain: false,
    metadata: input.metadata,
  };
}

export interface OpenCodeSessionMeta {
  id: string;
  title: string;
  directory: string;
  model: string | null;
  agent: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  time_created: number;
  time_updated: number;
}

export interface OpenCodeMessage {
  id: string;
  data: {
    role: string;
    time?: { created?: number; completed?: number };
    parentID?: string;
    model?: { providerID?: string; modelID?: string };
  };
  parts: OpenCodePart[];
}

export interface OpenCodePart {
  id: string;
  data: {
    type: string;
    text?: string;
    time?: { start?: number; end?: number };
    callID?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      time?: { start?: number; end?: number };
    };
  };
}

// OpenCode persists token usage at Session granularity. Keep that aggregate in
// one explicitly labelled LLM Span instead of inventing a per-message split.
export function parseOpenCodeSession(
  session: OpenCodeSessionMeta,
  messages: OpenCodeMessage[],
): ParsedSession | null {
  const assistants = messages.filter((message) => message.data.role === 'assistant');
  if (assistants.length === 0) return null;

  const sessionId = session.id;
  const model =
    modelIdentity(session.model) ??
    assistants.find((message) => message.data.model)?.data.model?.modelID;
  const aggregateId = `${sessionId}:session-aggregate`;
  const spans: Span[] = [
    makeSpan({
      id: aggregateId,
      sessionId,
      type: 'llm_turn',
      name: model ?? 'opencode',
      startTime: session.time_created,
      endTime: session.time_updated,
      inputTokens: session.tokens_input,
      cacheCreationTokens: session.tokens_cache_write,
      cacheReadTokens: session.tokens_cache_read,
      outputTokens: session.tokens_output + session.tokens_reasoning,
      model,
      metadata: {
        tokenUsageSource: 'session_aggregate',
        tokenUsageClassified: true,
        sourceOutputTokens: session.tokens_output,
        sourceReasoningTokens: session.tokens_reasoning,
        sourceAgent: session.agent ?? undefined,
      },
    }),
  ];

  for (const message of assistants.sort(
    (left, right) => (left.data.time?.created ?? 0) - (right.data.time?.created ?? 0),
  )) {
    const startTime = message.data.time?.created ?? session.time_created;
    const endTime = message.data.time?.completed;
    for (const part of message.parts) {
      const partId = `${sessionId}:${part.id}`;
      const partStartTime = part.data.time?.start ?? part.data.state?.time?.start ?? startTime;
      const partEndTime = part.data.time?.end ?? part.data.state?.time?.end ?? endTime;
      const sourceMetadata = {
        sourceMessageId: message.id,
        sourceParentMessageId: message.data.parentID,
      };
      if (part.data.type === 'reasoning' && part.data.text) {
        spans.push(
          makeSpan({
            id: `${partId}:reasoning`,
            sessionId,
            parentId: aggregateId,
            type: 'thinking',
            name: 'reasoning',
            startTime: partStartTime,
            endTime: partEndTime,
            metadata: { ...sourceMetadata, thinking: truncate(part.data.text) },
          }),
        );
      } else if (part.data.type === 'text' && part.data.text) {
        spans.push(
          makeSpan({
            id: `${partId}:answer`,
            sessionId,
            parentId: aggregateId,
            type: 'answer',
            name: 'answer',
            startTime: partStartTime,
            endTime: partEndTime,
            metadata: { ...sourceMetadata, text: truncate(part.data.text) },
          }),
        );
      } else if (part.data.type === 'tool' && part.data.callID) {
        const output = part.data.state?.output;
        spans.push(
          makeSpan({
            id: `${sessionId}:${part.data.callID}`,
            sessionId,
            parentId: aggregateId,
            type: 'tool_call',
            name: part.data.tool ?? 'unknown',
            startTime: partStartTime,
            endTime: partEndTime,
            isError: part.data.state?.status === 'error',
            outputBytes: output == null ? 0 : Buffer.byteLength(safeStringify(output), 'utf8'),
            metadata: {
              ...sourceMetadata,
              input: part.data.state?.input
                ? truncate(safeStringify(part.data.state.input))
                : undefined,
              output: output == null ? undefined : truncate(safeStringify(output)),
            },
          }),
        );
      }
    }
  }

  return {
    sessionId,
    meta: {
      name: session.title || sessionId.slice(0, 8),
      filePath: `opencode://sessions/${sessionId}`,
      startTime: session.time_created,
      endTime: session.time_updated,
      cwd: session.directory,
      messageCount: assistants.length,
      agent: 'opencode',
    },
    spans,
  };
}

function modelIdentity(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { modelID?: unknown; id?: unknown; providerID?: unknown };
    if (typeof parsed.modelID === 'string') return parsed.modelID;
    if (typeof parsed.id === 'string') return parsed.id;
    if (typeof parsed.providerID === 'string') return parsed.providerID;
  } catch {
    return raw;
  }
  return undefined;
}

import type { ParsedSession, Span, SpanType } from '../types';

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
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
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
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
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

export interface ZedThreadInput {
  id: string;
  summary: string;
  folderPaths: string | null;
  updatedAt: string;
  createdAt: string | null;
  dataType: string;
  dataBuffer: Buffer; // zstd-decompressed
}

interface ZedToolUse {
  id: string;
  name?: string;
  input?: unknown;
  raw_input?: unknown;
}

interface ZedToolResult {
  tool_use_id?: string;
  tool_name?: string;
  is_error?: boolean;
  content?: unknown;
  output?: unknown;
}

interface ZedContentItem {
  Text?: string;
  ToolUse?: ZedToolUse;
}

interface ZedMessage {
  User?: { id?: string; content?: ZedContentItem[] };
  Agent?: {
    content?: ZedContentItem[];
    tool_results?: Record<string, ZedToolResult>;
  };
}

interface ZedThreadPayload {
  title?: string;
  messages?: ZedMessage[];
  request_token_usage?: Record<string, { input_tokens?: number; output_tokens?: number }>;
  model?: { provider?: string; model?: string };
}

// Parse the current Zed zstd payload: one JSON object containing tagged User /
// Agent messages, request-scoped token usage, model identity, and tool results.
export async function parseZedThread(input: ZedThreadInput): Promise<ParsedSession | null> {
  let payload: ZedThreadPayload;
  try {
    payload = JSON.parse(input.dataBuffer.toString('utf8')) as ZedThreadPayload;
  } catch {
    return null;
  }
  if (!Array.isArray(payload.messages)) return null;
  const messages: ZedMessage[] = payload.messages;

  const startTime = input.createdAt ? toMs(input.createdAt) : toMs(input.updatedAt);
  const endTime = toMs(input.updatedAt);
  const model = payload.model?.model || payload.model?.provider;
  const toolResults = new Map<string, ZedToolResult>();
  for (const message of messages) {
    for (const [callId, result] of Object.entries(message.Agent?.tool_results ?? {})) {
      toolResults.set(result.tool_use_id || callId, result);
    }
  }

  const spans: Span[] = [];
  let currentTurnId: string | undefined;
  let messageCount = 0;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message: ZedMessage = messages[messageIndex];
    if (message.User) {
      const requestId = message.User.id || `request-${messageIndex}`;
      currentTurnId = `${input.id}-turn-${requestId}`;
      const usage = payload.request_token_usage?.[requestId];
      spans.push(
        makeSpan({
          id: currentTurnId,
          sessionId: input.id,
          type: 'llm_turn',
          name: model || 'zed',
          startTime,
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          model,
          metadata: usage ? { tokenUsageSource: 'request_token_usage' } : undefined,
        }),
      );
      messageCount++;
      continue;
    }

    const agent = message.Agent;
    if (!agent) continue;
    if (!currentTurnId) {
      currentTurnId = `${input.id}-turn-${messageIndex}`;
      spans.push(
        makeSpan({
          id: currentTurnId,
          sessionId: input.id,
          type: 'llm_turn',
          name: model || 'zed',
          startTime,
          model,
        }),
      );
      messageCount++;
    }

    for (let contentIndex = 0; contentIndex < (agent.content ?? []).length; contentIndex++) {
      const content = agent.content?.[contentIndex];
      if (typeof content?.Text === 'string' && content.Text.length > 0) {
        spans.push(
          makeSpan({
            id: `${currentTurnId}-answer-${messageIndex}-${contentIndex}`,
            sessionId: input.id,
            parentId: currentTurnId,
            type: 'answer',
            name: 'answer',
            startTime,
            metadata: { text: truncate(content.Text) },
          }),
        );
      }

      const tool = content?.ToolUse;
      if (tool?.id) {
        const result = toolResults.get(tool.id);
        const output = result?.output ?? result?.content;
        spans.push(
          makeSpan({
            id: tool.id,
            sessionId: input.id,
            parentId: currentTurnId,
            type: 'tool_call',
            name: tool.name || result?.tool_name || 'unknown',
            startTime,
            isError: result?.is_error,
            outputBytes: output == null ? 0 : Buffer.byteLength(safeStringify(output), 'utf8'),
            metadata: {
              input: truncate(safeStringify(tool.input ?? tool.raw_input)),
              output: output == null ? undefined : truncate(safeStringify(output)),
            },
          }),
        );
      }
    }
  }

  if (spans.length === 0) return null;
  return {
    sessionId: input.id,
    meta: {
      name: input.summary || payload.title || input.id.slice(0, 8),
      filePath: `zed://threads/${input.id}`,
      startTime,
      endTime,
      cwd: extractFirstFolder(input.folderPaths),
      messageCount,
      agent: 'zed',
    },
    spans,
  };
}

function extractFirstFolder(folderPaths: string | null): string | undefined {
  if (!folderPaths) return undefined;
  const trimmed = folderPaths.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('[')) return trimmed;
  try {
    const arr = JSON.parse(trimmed);
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : undefined;
  } catch {
    return undefined;
  }
}

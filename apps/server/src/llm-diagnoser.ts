import {
  type LlmDiagnoseContext,
  type LlmDiagnoser,
  type LlmDiagnosisResponse,
  type LlmFinding,
  redactSensitiveText,
  type SemanticDiagnosisReport,
} from '@agent-profile/core';
import type { ProviderConfiguration } from './provider-config';

// LLM client for semantic diagnosis. Supports Anthropic (native) + OpenAI-compatible providers.
// The client is only invoked by the diagnosis route after request-scoped opt-in.

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const MAX_TASK_TITLE_CHARACTERS = 500;
const MAX_THINKING_CHARACTERS = 500;
const MAX_TOOL_INPUT_CHARACTERS = 200;
const MAX_AUDIT_ENTRIES = 100;

type SemanticProvider = 'anthropic' | 'openai';
type ProviderCallStatus = 'completed' | 'failed';
export type ProviderTestFailureReason =
  | 'not_configured'
  | 'timeout'
  | 'network_error'
  | 'authentication_error'
  | 'model_unavailable'
  | 'invalid_request'
  | 'endpoint_not_found'
  | 'http_error';

export interface ProviderTestResult {
  status: 'passed' | 'failed';
  reason?: ProviderTestFailureReason;
  httpStatus?: number;
}

export interface LlmDiagnoserOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  provider?: SemanticProvider;
}

export interface SemanticDiagnoser extends LlmDiagnoser {
  provider: SemanticProvider;
  diagnoseWithMetadata(ctx: LlmDiagnoseContext): Promise<LlmDiagnosisResponse>;
}

export interface SemanticDiagnosisAuditEntry {
  sessionId: string;
  requestedAt: number;
  completedAt: number;
  status: SemanticDiagnosisReport['status'];
  provider: SemanticDiagnosisReport['provider'];
  payload: SemanticDiagnosisReport['payload'];
}

export interface SemanticDiagnosisAuditStore {
  record(entry: SemanticDiagnosisAuditEntry): void;
  snapshot(): SemanticDiagnosisAuditEntry[];
}

const PROVIDER_TEST_TIMEOUT_MS = 10_000;
const PROVIDER_ERROR_BODY_LIMIT = 4096;

async function readProviderErrorHint(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < PROVIDER_ERROR_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    if (text.length >= PROVIDER_ERROR_BODY_LIMIT) await reader.cancel();
    return text.slice(0, PROVIDER_ERROR_BODY_LIMIT);
  } catch {
    return '';
  } finally {
    reader.releaseLock();
  }
}

function classifyProviderHttpFailure(status: number, body: string): ProviderTestFailureReason {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 404) return 'endpoint_not_found';
  if (status === 400) {
    const normalized = body.toLowerCase();
    if (
      normalized.includes('model') &&
      /(invalid|not found|unavailable|unsupported|does not exist|unknown)/.test(normalized)
    ) {
      return 'model_unavailable';
    }
    return 'invalid_request';
  }
  return 'http_error';
}

export async function testProviderConnection(
  configuration: ProviderConfiguration | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderTestResult> {
  if (!configuration) return { status: 'failed', reason: 'not_configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);
  const baseUrl = configuration.baseUrl.replace(/\/$/, '');
  const isAnthropic = configuration.provider === 'anthropic';
  const url = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = isAnthropic
    ? {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': configuration.apiKey,
      }
    : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${configuration.apiKey}`,
      };
  const requestBody = isAnthropic
    ? {
        model: configuration.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Respond with exactly OK.' }],
      }
    : {
        model: configuration.model,
        messages: [{ role: 'user', content: 'Respond with exactly OK.' }],
        max_tokens: 1,
        temperature: 0,
      };

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (response.ok) return { status: 'passed' };
    const errorBody = await readProviderErrorHint(response);
    return {
      status: 'failed',
      reason: classifyProviderHttpFailure(response.status, errorBody),
      httpStatus: response.status,
    };
  } catch {
    return {
      status: 'failed',
      reason: controller.signal.aborted ? 'timeout' : 'network_error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createSemanticDiagnosisAuditStore(
  maxEntries = MAX_AUDIT_ENTRIES,
): SemanticDiagnosisAuditStore {
  const limit = Math.max(1, Math.floor(maxEntries));
  let entries: SemanticDiagnosisAuditEntry[] = [];
  return {
    record(entry) {
      entries = [...entries, entry].slice(-limit);
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
    },
  };
}

function detectProvider(baseUrl: string, configured?: SemanticProvider): SemanticProvider {
  if (configured) return configured;
  if (process.env.LLM_PROVIDER === 'anthropic') return 'anthropic';
  if (process.env.LLM_PROVIDER === 'openai') return 'openai';
  return baseUrl.includes('anthropic') ? 'anthropic' : 'openai';
}

interface PromptBuildResult {
  prompt: string;
  payload: SemanticDiagnosisReport['payload'];
}

interface ParsedSemanticResponse {
  findings: LlmFinding[];
  valid: boolean;
}

function spanReference(index: number): string {
  return `span-${index + 1}`;
}

function buildPrompt(ctx: LlmDiagnoseContext): PromptBuildResult {
  const taskTitle = redactSensitiveText(ctx.taskTitle || 'Unknown', MAX_TASK_TITLE_CHARACTERS);
  const thinkingItems = ctx.thinkingTexts.slice(0, 5).map((thinking, index) => {
    const text = redactSensitiveText(thinking.text, MAX_THINKING_CHARACTERS);
    return { id: spanReference(index), text };
  });
  const toolItems = ctx.toolCallSequence.slice(0, 20).map((tool, index) => {
    const name = redactSensitiveText(tool.name, MAX_TOOL_INPUT_CHARACTERS);
    const input = redactSensitiveText(tool.input, MAX_TOOL_INPUT_CHARACTERS);
    return {
      isError: tool.isError,
      name,
      input,
      id: spanReference(ctx.thinkingTexts.length + index),
    };
  });
  const redactions = [
    taskTitle.redactions,
    ...thinkingItems.map((item) => item.text.redactions),
    ...toolItems.flatMap((item) => [item.name.redactions, item.input.redactions]),
  ].reduce((total, count) => total + count, 0);
  const characters = [
    taskTitle.text,
    ...thinkingItems.map((item) => item.text.text),
    ...toolItems.flatMap((item) => [item.name.text, item.input.text]),
  ].reduce((total, value) => total + value.length, 0);
  const thinkingSnippets = thinkingItems
    .map((item) => `[${item.id}] ${item.text.text}`)
    .join('\n---\n');
  const toolSummary = toolItems
    .map(
      (item) =>
        `${item.isError ? '❌' : '✓'} ${item.name.text}${item.input.text ? `: ${item.input.text}` : ''}`,
    )
    .join('\n');

  return {
    prompt: `Analyze this AI coding agent session and identify patterns of inefficiency:

Task: ${taskTitle.text}

=== Thinking Snippets (top 5 longest) ===
${thinkingSnippets || '(none)'}

=== Tool Call Sequence ===
${toolSummary || '(none)'}

Identify if any of these patterns exist:
1. thinking_detour: reasoning that goes off-task, loops, or is irrelevant
2. ineffective_exploration: repeated trial-and-error without progress
3. tool_off_target: tool calls not serving the task goal

Output STRICT JSON array: [{"type":"thinking_detour|ineffective_exploration|tool_off_target","severity":"high|medium|low","title":"...","detail":"...","suggestion":"...","spanIds":["..."]}]
Only include genuine issues. Return empty array [] if none found.`,
    payload: {
      mode: 'bounded_redacted',
      thinkingItems: thinkingItems.length,
      toolItems: toolItems.length,
      characters,
      redactions,
      rawContentIncluded: false,
    },
  };
}

function parseResponse(
  content: string,
  spanIdsByReference: Map<string, string>,
): ParsedSemanticResponse {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { findings: [], valid: false };
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return { findings: [], valid: false };
    const findings: LlmFinding[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) return { findings: [], valid: false };
      const type = item.type;
      const severity = item.severity;
      if (
        !isSemanticType(type) ||
        !isSeverity(severity) ||
        typeof item.title !== 'string' ||
        typeof item.detail !== 'string'
      ) {
        return { findings: [], valid: false };
      }
      const title = redactSensitiveText(item.title, 300).text;
      const detail = redactSensitiveText(item.detail, 1_000).text;
      const suggestion =
        typeof item.suggestion === 'string' ? redactSensitiveText(item.suggestion, 500).text : '';
      const spanIds = Array.isArray(item.spanIds)
        ? item.spanIds
            .filter((spanId): spanId is string => typeof spanId === 'string')
            .map((spanId) => spanIdsByReference.get(spanId))
            .filter((spanId): spanId is string => spanId !== undefined)
            .slice(0, 20)
        : [];
      findings.push({ type, severity, title: `[LLM] ${title}`, detail, suggestion, spanIds });
    }
    return { findings, valid: true };
  } catch {
    return { findings: [], valid: false };
  }
}

interface ProviderCallResult {
  findings: LlmFinding[];
  status: ProviderCallStatus;
}

async function callAnthropic(
  prompt: string,
  key: string,
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  spanIdsByReference: Map<string, string>,
): Promise<ProviderCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetchImpl(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1_000,
        system: 'You are an AI agent runtime analyst. Output strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { findings: [], status: 'failed' };
    const data = (await res.json()) as { content?: { type: string; text: string }[] };
    const textContent = data.content?.find((content) => content.type === 'text')?.text;
    const parsed = textContent ? parseResponse(textContent, spanIdsByReference) : null;
    return {
      findings: parsed?.findings ?? [],
      status: parsed?.valid ? 'completed' : 'failed',
    };
  } catch {
    return { findings: [], status: 'failed' };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAI(
  prompt: string,
  key: string,
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  spanIdsByReference: Map<string, string>,
): Promise<ProviderCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an AI agent runtime analyst. Output strict JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1_000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { findings: [], status: 'failed' };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    const parsed = content ? parseResponse(content, spanIdsByReference) : null;
    return {
      findings: parsed?.findings ?? [],
      status: parsed?.valid ? 'completed' : 'failed',
    };
  } catch {
    return { findings: [], status: 'failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export function createLlmDiagnoser(
  apiKey?: string,
  options: LlmDiagnoserOptions = {},
): SemanticDiagnoser | null {
  const key = apiKey || LLM_API_KEY;
  if (!key) return null;

  const baseUrl = (options.baseUrl || LLM_BASE_URL).replace(/\/$/, '');
  const model = options.model || LLM_MODEL;
  const provider = detectProvider(baseUrl, options.provider);
  const fetchImpl = options.fetchImpl || fetch;

  const diagnoseWithMetadata = async (ctx: LlmDiagnoseContext): Promise<LlmDiagnosisResponse> => {
    const built = buildPrompt(ctx);
    const baseReport: Omit<SemanticDiagnosisReport, 'status' | 'findingCount'> = {
      requested: true,
      consent: 'granted',
      provider,
      payload: built.payload,
      audit: {
        recorded: false,
        retention: 'process_bounded_content_free',
        rawContentStored: false,
      },
      limitations: [
        'Only bounded, redacted task/thinking/tool-input excerpts are sent to the configured Provider.',
        'The configured endpoint locality is not independently verified by this local process.',
        'Semantic findings are inferential and heuristic diagnosis remains available without a Provider.',
      ],
    };
    if (ctx.thinkingTexts.length === 0 && ctx.toolCallSequence.length === 0) {
      return {
        findings: [],
        semantic: { ...baseReport, status: 'completed', findingCount: 0 },
      };
    }

    const spanIdsByReference = new Map<string, string>(
      [...ctx.thinkingTexts, ...ctx.toolCallSequence].flatMap((item, index) => [
        [item.spanId, item.spanId],
        [spanReference(index), item.spanId],
      ]),
    );
    const call =
      provider === 'anthropic'
        ? await callAnthropic(built.prompt, key, baseUrl, model, fetchImpl, spanIdsByReference)
        : await callOpenAI(built.prompt, key, baseUrl, model, fetchImpl, spanIdsByReference);
    return {
      findings: call.findings,
      semantic: { ...baseReport, status: call.status, findingCount: call.findings.length },
    };
  };

  return {
    provider,
    diagnose: async (ctx) => (await diagnoseWithMetadata(ctx)).findings,
    diagnoseWithMetadata,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSemanticType(value: unknown): value is LlmFinding['type'] {
  return (
    value === 'thinking_detour' ||
    value === 'ineffective_exploration' ||
    value === 'tool_off_target'
  );
}

function isSeverity(value: unknown): value is LlmFinding['severity'] {
  return value === 'high' || value === 'medium' || value === 'low';
}

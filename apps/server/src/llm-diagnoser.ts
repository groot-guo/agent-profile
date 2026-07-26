import type { LlmDiagnoseContext, LlmDiagnoser, LlmFinding } from '@agent-profile/core';

// LLM client for semantic diagnosis. Supports Anthropic (native) + OpenAI-compatible providers.
//
// Env vars:
//   LLM_API_KEY     — required
//   LLM_PROVIDER    — "anthropic" | "openai" (default: auto-detect from LLM_BASE_URL)
//   LLM_BASE_URL    — API base URL (Anthropic: https://api.anthropic.com/v1, OpenAI-compatible: https://api.deepseek.com/v1)
//   LLM_MODEL       — model id (Anthropic: claude-haiku-4-5-20251001, OpenAI: deepseek-chat)
//
// Examples:
//   Claude Code key → LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-haiku-4-5-20251001
//   DeepSeek key    → LLM_API_KEY=sk-... (defaults work)
//   Zhipu GLM key   → LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 LLM_MODEL=glm-4-flash

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

function detectProvider(): 'anthropic' | 'openai' {
  if (process.env.LLM_PROVIDER === 'anthropic') return 'anthropic';
  if (process.env.LLM_PROVIDER === 'openai') return 'openai';
  // Auto-detect: anthropic endpoint contains "anthropic"
  if (LLM_BASE_URL.includes('anthropic')) return 'anthropic';
  return 'openai';
}

function buildPrompt(ctx: LlmDiagnoseContext): string {
  const thinkingSnippets = ctx.thinkingTexts
    .slice(0, 5)
    .map((t) => `[${t.spanId.slice(0, 8)}] ${t.text.slice(0, 2000)}`)
    .join('\n---\n');

  const toolSummary = ctx.toolCallSequence
    .slice(0, 20)
    .map((t) => `${t.isError ? '❌' : '✓'} ${t.name}${t.input ? ': ' + t.input.slice(0, 200) : ''}`)
    .join('\n');

  return `Analyze this AI coding agent session and identify patterns of inefficiency:

Task: ${ctx.taskTitle || 'Unknown'}

=== Thinking Snippets (top 5 longest) ===
${thinkingSnippets || '(none)'}

=== Tool Call Sequence ===
${toolSummary || '(none)'}

Identify if any of these patterns exist:
1. thinking_detour: reasoning that goes off-task, loops, or is irrelevant
2. ineffective_exploration: repeated trial-and-error without progress
3. tool_off_target: tool calls not serving the task goal

Output STRICT JSON array: [{"type":"thinking_detour|ineffective_exploration|tool_off_target","severity":"high|medium|low","title":"...","detail":"...","suggestion":"...","spanIds":["..."]}]
Only include genuine issues. Return empty array [] if none found.`;
}

function parseResponse(content: string): LlmFinding[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  const findings: LlmFinding[] = JSON.parse(jsonMatch[0]);
  return findings.map((f) => ({
    type: f.type,
    severity: f.severity,
    title: `[LLM] ${f.title}`,
    detail: f.detail,
    suggestion: f.suggestion || '',
    spanIds: f.spanIds || [],
  }));
}

async function callAnthropic(prompt: string, key: string): Promise<LlmFinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${LLM_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 1000,
        system: 'You are an AI agent runtime analyst. Output strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = (await res.json()) as { content?: { type: string; text: string }[] };
    const textContent = data.content?.find((c) => c.type === 'text')?.text;
    return textContent ? parseResponse(textContent) : [];
  } catch {
    return [];
  }
}

async function callOpenAI(prompt: string, key: string): Promise<LlmFinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an AI agent runtime analyst. Output strict JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    return content ? parseResponse(content) : [];
  } catch {
    return [];
  }
}

export function createLlmDiagnoser(apiKey?: string): LlmDiagnoser | null {
  const key = apiKey || LLM_API_KEY;
  if (!key) return null;

  const provider = detectProvider();

  return {
    async diagnose(ctx: LlmDiagnoseContext): Promise<LlmFinding[]> {
      if (ctx.thinkingTexts.length === 0 && ctx.toolCallSequence.length === 0) return [];
      const prompt = buildPrompt(ctx);

      if (provider === 'anthropic') {
        return callAnthropic(prompt, key);
      }
      return callOpenAI(prompt, key);
    },
  };
}

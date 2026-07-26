import type { LlmDiagnoseContext, LlmDiagnoser, LlmFinding } from '@agent-profile/core';

// OpenAI-compatible LLM client for semantic diagnosis
// Config via env: LLM_API_KEY, LLM_BASE_URL (default "https://api.deepseek.com/v1"), LLM_MODEL (default "deepseek-chat")

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

export function createLlmDiagnoser(apiKey?: string): LlmDiagnoser | null {
  const key = apiKey || LLM_API_KEY;
  if (!key) return null;

  return {
    async diagnose(ctx: LlmDiagnoseContext): Promise<LlmFinding[]> {
      if (ctx.thinkingTexts.length === 0 && ctx.toolCallSequence.length === 0) return [];

      const thinkingSnippets = ctx.thinkingTexts
        .slice(0, 5)
        .map((t) => `[${t.spanId.slice(0, 8)}] ${t.text.slice(0, 2000)}`)
        .join('\n---\n');

      const toolSummary = ctx.toolCallSequence
        .slice(0, 20)
        .map((t) => `${t.isError ? '❌' : '✓'} ${t.name}${t.input ? ': ' + t.input.slice(0, 200) : ''}`)
        .join('\n');

      const prompt = `Analyze this AI coding agent session and identify patterns of inefficiency:

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

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({
            model: LLM_MODEL,
            messages: [
              { role: 'system', content: 'You are an AI agent runtime analyst. Output strict JSON only.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 1000,
            temperature: 0.1,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) return [];
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (!content) return [];

        // Extract JSON from response (may be wrapped in markdown)
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
      } catch {
        return []; // timeout or network error → degrade gracefully
      }
    },
  };
}

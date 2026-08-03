import { describe, expect, it } from 'vitest';
import { createLlmDiagnoser, createSemanticDiagnosisAuditStore } from '../llm-diagnoser';

describe('semantic diagnosis Provider client', () => {
  it('keeps the local audit store bounded and content-free', () => {
    const store = createSemanticDiagnosisAuditStore(2);
    const payload = {
      mode: 'bounded_redacted' as const,
      thinkingItems: 1,
      toolItems: 1,
      characters: 10,
      redactions: 1,
      rawContentIncluded: false as const,
    };

    for (const sessionId of ['one', 'two', 'three']) {
      store.record({
        sessionId,
        requestedAt: 1,
        completedAt: 2,
        status: 'completed',
        provider: 'openai',
        payload,
      });
    }

    expect(store.snapshot().map((entry) => entry.sessionId)).toEqual(['two', 'three']);
    expect(JSON.stringify(store.snapshot())).not.toContain('raw-private-marker');
  });

  it('sends only bounded redacted payload content and validates findings', async () => {
    const requests: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(init || {});
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    type: 'tool_off_target',
                    severity: 'medium',
                    title: 'off target',
                    detail: 'check the selected tool',
                    suggestion: 'narrow the scope',
                    spanIds: ['tool-1', 'not-from-session'],
                  },
                ]),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const diagnoser = createLlmDiagnoser('test-key', {
      baseUrl: 'https://provider.invalid/v1',
      fetchImpl,
      provider: 'openai',
    });

    const result = await diagnoser?.diagnoseWithMetadata({
      sessionId: 'session-1',
      taskTitle: 'api_key=sk-supersecret123456789',
      thinkingTexts: [
        { spanId: 'thinking-1', text: `token=sk-anothersecret123456789 ${'x'.repeat(900)}` },
      ],
      toolCallSequence: [
        { spanId: 'tool-1', name: 'Bash', input: 'Bearer super-secret-value', isError: false },
      ],
    });

    expect(result?.semantic).toMatchObject({
      status: 'completed',
      provider: 'openai',
      payload: {
        mode: 'bounded_redacted',
        thinkingItems: 1,
        toolItems: 1,
        rawContentIncluded: false,
      },
      audit: { recorded: false, rawContentStored: false },
    });
    expect(result?.semantic.payload.redactions).toBeGreaterThanOrEqual(3);
    expect(result?.findings).toMatchObject([{ type: 'tool_off_target', spanIds: ['tool-1'] }]);
    const payload = JSON.stringify(requests[0]?.body);
    expect(payload).not.toContain('sk-supersecret123456789');
    expect(payload).not.toContain('sk-anothersecret123456789');
    expect(payload).not.toContain('super-secret-value');
    expect(payload).toContain('[REDACTED');
  });

  it('reports Provider failure without throwing or retaining the response body', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('provider-secret-response', { status: 503 });
    const diagnoser = createLlmDiagnoser('test-key', { fetchImpl, provider: 'openai' });

    const result = await diagnoser?.diagnoseWithMetadata({
      sessionId: 'session-1',
      thinkingTexts: [{ spanId: 'thinking-1', text: 'bounded reasoning' }],
      toolCallSequence: [],
    });

    expect(result).toMatchObject({
      findings: [],
      semantic: { status: 'failed', audit: { rawContentStored: false } },
    });
    expect(JSON.stringify(result)).not.toContain('provider-secret-response');
  });
});

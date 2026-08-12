import { describe, expect, it } from 'vitest';
import {
  createLlmDiagnoser,
  createSemanticDiagnosisAuditStore,
  testProviderConnection,
} from '../llm-diagnoser';

describe('semantic diagnosis Provider client', () => {
  it('tests OpenAI-compatible and Anthropic-native protocol shapes', async () => {
    const requests: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return new Response('{}', { status: 200 });
    };

    await expect(
      testProviderConnection(
        {
          provider: 'openai',
          baseUrl: 'https://openai.example/v1/',
          model: 'fixture-openai',
          apiKey: 'openai-secret',
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ status: 'passed' });
    await expect(
      testProviderConnection(
        {
          provider: 'anthropic',
          baseUrl: 'https://anthropic.example/v1',
          model: 'fixture-anthropic',
          apiKey: 'anthropic-secret',
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ status: 'passed' });

    expect(requests[0]?.input).toBe('https://openai.example/v1/chat/completions');
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer openai-secret',
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: 'fixture-openai',
      max_tokens: 1,
    });
    expect(requests[1]?.input).toBe('https://anthropic.example/v1/messages');
    expect(requests[1]?.init?.headers).toMatchObject({
      'x-api-key': 'anthropic-secret',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      model: 'fixture-anthropic',
      max_tokens: 1,
    });
  });

  it('classifies HTTP and network probe failures without response content', async () => {
    await expect(
      testProviderConnection(
        {
          provider: 'openai',
          baseUrl: 'https://provider.example/v1',
          model: 'fixture',
          apiKey: 'secret',
        },
        async () => new Response('provider-response-secret', { status: 401 }),
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'authentication_error', httpStatus: 401 });
    await expect(
      testProviderConnection(
        {
          provider: 'openai',
          baseUrl: 'https://provider.example/v1',
          model: 'fixture',
          apiKey: 'secret',
        },
        async () => {
          throw new Error('network-secret');
        },
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'network_error' });
  });

  it('classifies a provider model rejection without exposing the response body', async () => {
    const responseSecret = 'provider-response-secret';
    await expect(
      testProviderConnection(
        {
          provider: 'openai',
          baseUrl: 'https://provider.example/v1',
          model: 'unsupported-model',
          apiKey: 'secret',
        },
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: '400',
                message: `Invalid model name; ${responseSecret}`,
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'model_unavailable', httpStatus: 400 });
  });

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
      findingCount: 1,
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

  it('marks a non-JSON Provider response as failed instead of a completed empty diagnosis', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'The session looks fine.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const diagnoser = createLlmDiagnoser('test-key', { fetchImpl, provider: 'openai' });

    const result = await diagnoser?.diagnoseWithMetadata({
      sessionId: 'session-1',
      thinkingTexts: [],
      toolCallSequence: [{ spanId: 'tool-1', name: 'Bash', input: '{}', isError: false }],
    });

    expect(result).toMatchObject({
      findings: [],
      semantic: { status: 'failed', findingCount: 0 },
    });
  });

  it('keeps a valid empty semantic array as a completed zero-finding result', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const diagnoser = createLlmDiagnoser('test-key', { fetchImpl, provider: 'openai' });

    const result = await diagnoser?.diagnoseWithMetadata({
      sessionId: 'session-1',
      thinkingTexts: [],
      toolCallSequence: [{ spanId: 'tool-1', name: 'Bash', input: '{}', isError: false }],
    });

    expect(result).toMatchObject({
      findings: [],
      semantic: { status: 'completed', findingCount: 0 },
    });
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

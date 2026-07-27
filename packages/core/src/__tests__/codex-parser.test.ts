import { describe, expect, it } from 'vitest';
import { type CodexEntry, parseCodexTranscript } from '../parsers/codex';

function rollout(
  meta: Record<string, unknown>,
  lastTokenUsage: Record<string, number> = {
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 20,
    reasoning_output_tokens: 5,
    total_tokens: 165,
  },
): CodexEntry[] {
  return [
    {
      timestamp: '2026-07-26T08:00:00.000Z',
      type: 'session_meta',
      payload: {
        cwd: '/workspace/agent-profile',
        cli_version: '1.0.0',
        model_provider: 'openai',
        ...meta,
      },
    },
    {
      timestamp: '2026-07-26T08:00:01.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1' },
    },
    {
      timestamp: '2026-07-26T08:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: lastTokenUsage,
        },
      },
    },
  ];
}

describe('parseCodexTranscript', () => {
  it('uses the rollout thread id for a top-level session', () => {
    const parsed = parseCodexTranscript(rollout({ id: 'thread-top', session_id: 'thread-top' }), {
      filePath: '/codex/rollout-top.jsonl',
    });

    expect(parsed?.sessionId).toBe('thread-top');
    expect(parsed?.meta.cwd).toBe('/workspace/agent-profile');
    expect(parsed?.spans).toHaveLength(1);
    expect(parsed?.spans[0].sessionId).toBe('thread-top');
    expect(parsed?.spans[0].isSidechain).toBe(false);
    expect(parsed?.spans[0]).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 40,
      outputTokens: 25,
    });
    expect(parsed?.spans[0].metadata).toBeUndefined();
  });

  it('keeps a child rollout distinct and marks every span as Sidechain', () => {
    const parsed = parseCodexTranscript(
      rollout({
        id: 'thread-child',
        session_id: 'thread-parent',
        parent_thread_id: 'thread-parent',
      }),
      { filePath: '/codex/rollout-child.jsonl' },
    );

    expect(parsed?.sessionId).toBe('thread-child');
    expect(parsed?.spans).toHaveLength(1);
    expect(parsed?.spans.every((span) => span.sessionId === 'thread-child')).toBe(true);
    expect(parsed?.spans.every((span) => span.isSidechain)).toBe(true);
  });

  it('falls back to session_id for legacy rollouts without id', () => {
    const parsed = parseCodexTranscript(rollout({ session_id: 'legacy-session' }), {
      filePath: '/codex/rollout-legacy.jsonl',
    });

    expect(parsed?.sessionId).toBe('legacy-session');
    expect(parsed?.spans[0].isSidechain).toBe(false);
  });

  it('uses total_tokens when Codex reports no classified token fields', () => {
    const parsed = parseCodexTranscript(
      rollout(
        { id: 'thread-total-only', session_id: 'thread-total-only' },
        {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 1_234,
        },
      ),
      { filePath: '/codex/rollout-total-only.jsonl' },
    );

    expect(parsed?.spans).toHaveLength(1);
    expect(parsed?.spans[0]).toMatchObject({
      inputTokens: 1_234,
      cacheReadTokens: 0,
      outputTokens: 0,
      metadata: {
        tokenUsageSource: 'total_tokens_fallback',
        tokenUsageClassified: false,
      },
    });
  });

});

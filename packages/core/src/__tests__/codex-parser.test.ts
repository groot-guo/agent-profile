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
      payload: { turn_id: 'turn-1', model: 'gpt-5.6-sol' },
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
      model: 'gpt-5.6-sol',
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

  it('attributes each LLM turn to its captured turn-context model', () => {
    const entries = rollout({ id: 'mixed-model-thread' });
    entries.push(
      {
        timestamp: '2026-07-26T08:01:00.000Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-2', model: 'gpt-5.6-terra' },
      },
      {
        timestamp: '2026-07-26T08:01:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 10,
              output_tokens: 5,
              reasoning_output_tokens: 2,
              total_tokens: 67,
            },
          },
        },
      },
    );

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/mixed-model.jsonl' });
    expect(
      parsed?.spans.filter((span) => span.type === 'llm_turn').map((span) => span.model),
    ).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra']);
  });

  it('keeps model identity unknown when only a provider is captured', () => {
    const entries = rollout({ id: 'provider-only-thread', model_provider: 'openai' });
    delete entries[1].payload.model;

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/provider-only.jsonl' });
    expect(parsed?.spans[0]).toMatchObject({ name: 'codex' });
    expect(parsed?.spans[0].model).toBeUndefined();
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

  it('rejects non-actionable external histories materialized by Codex Desktop', () => {
    const timestamp = '2026-07-08T10:05:43.713Z';
    const entries: CodexEntry[] = [
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: 'migrated-thread',
          cwd: '/workspace/im',
          source: 'vscode',
          originator: 'Codex Desktop',
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'external-import-turn-1',
          started_at: 1_780_000_000,
        },
      },
      {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'private first prompt' }],
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'First answer' },
      },
      {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'First answer' }],
        },
      },
      {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '[external_agent_tool_call: Bash]\ncommand: pwd\n[/external_agent_tool_call]',
            },
          ],
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'external-import-turn-1' },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'external-import-turn-2',
          started_at: 1_780_000_060,
        },
      },
      {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'private second prompt' }],
        },
      },
      {
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Second answer' }],
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 0,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 0,
            },
          },
        },
      },
      {
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'external-import-turn-2',
          completed_at: 1_780_000_090,
        },
      },
    ];

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/migrated.jsonl' });
    expect(parsed).toBeNull();
  });

  it('does not turn modern context snapshot messages into an extra turn', () => {
    const entries = rollout({
      id: 'modern-thread',
      session_id: 'modern-thread',
      source: 'vscode',
      originator: 'Codex Desktop',
    });
    entries.splice(
      2,
      0,
      {
        timestamp: '2026-07-26T08:00:00.500Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'context snapshot' }],
        },
      },
      {
        timestamp: '2026-07-26T08:00:01.500Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Modern answer' }],
        },
      },
      {
        timestamp: '2026-07-26T08:00:01.500Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Modern answer' },
      },
    );

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/modern.jsonl' });

    expect(parsed?.meta.messageCount).toBe(1);
    expect(parsed?.meta.cwd).toBe('/workspace/agent-profile');
    expect(parsed?.spans.filter((span) => span.type === 'llm_turn')).toHaveLength(1);
    expect(parsed?.spans.filter((span) => span.type === 'answer')).toHaveLength(1);
  });
});

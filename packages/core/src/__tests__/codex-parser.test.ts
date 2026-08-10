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
      metadata: {
        tokenUsageSource: 'token_count',
        tokenUsageClassified: true,
      },
    });
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
    expect(parsed?.meta.sourceParentSessionId).toBe('thread-parent');
    expect(parsed?.spans).toHaveLength(1);
    expect(parsed?.spans.every((span) => span.sessionId === 'thread-child')).toBe(true);
    expect(parsed?.spans.every((span) => span.isSidechain)).toBe(true);
  });

  it('scopes inherited parent-context spans and does not attribute parent usage to a child', () => {
    const entries: CodexEntry[] = [
      {
        timestamp: '2026-08-10T06:53:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'child-session',
          session_id: 'parent-session',
          parent_thread_id: 'parent-session',
        },
      },
      {
        timestamp: '2026-08-10T06:53:00.001Z',
        type: 'session_meta',
        payload: { id: 'parent-session', session_id: 'parent-session' },
      },
      {
        timestamp: '2026-08-10T06:53:00.002Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'parent-turn' },
      },
      {
        timestamp: '2026-08-10T06:53:00.003Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'inherited answer' }],
          internal_chat_message_metadata_passthrough: { turn_id: 'parent-turn' },
        },
      },
      {
        timestamp: '2026-08-10T06:53:00.004Z',
        type: 'turn_context',
        payload: { turn_id: 'parent-turn', model: 'parent-model' },
      },
      {
        timestamp: '2026-08-10T06:53:00.005Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 900, output_tokens: 90 } },
        },
      },
      {
        timestamp: '2026-08-10T06:53:00.006Z',
        type: 'turn_context',
        payload: { turn_id: 'parent-turn-2', model: 'parent-model-2' },
      },
      {
        timestamp: '2026-08-10T06:53:00.006Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'second inherited answer' }],
          internal_chat_message_metadata_passthrough: { turn_id: 'parent-turn-2' },
        },
      },
      {
        timestamp: '2026-08-10T06:53:00.006Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 800, output_tokens: 80 } },
        },
      },
      {
        timestamp: '2026-08-10T06:53:00.007Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'child-turn' },
      },
      {
        timestamp: '2026-08-10T06:53:00.008Z',
        type: 'turn_context',
        payload: { turn_id: 'child-turn', model: 'child-model' },
      },
      {
        timestamp: '2026-08-10T06:53:00.009Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 9, output_tokens: 3 } },
        },
      },
    ];

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/child-context.jsonl' });
    const spans = parsed?.spans ?? [];
    expect(new Set(spans.map((span) => span.id)).size).toBe(spans.length);
    expect(spans.every((span) => span.id.startsWith('codex:child-session:'))).toBe(true);
    expect(spans.filter((span) => span.id.includes('parent-turn'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'llm_turn',
          model: undefined,
          inputTokens: 0,
          outputTokens: 0,
          metadata: expect.objectContaining({
            ownershipStatus: 'cross_session',
            sourceSessionId: 'parent-session',
            tokenUsageSource: 'not_captured',
          }),
        }),
        expect.objectContaining({
          type: 'answer',
          parentId: 'codex:child-session:parent-turn',
          metadata: expect.objectContaining({ ownershipStatus: 'cross_session' }),
        }),
      ]),
    );
    expect(spans.filter((span) => span.id.includes('parent-turn-2'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'llm_turn',
          model: undefined,
          inputTokens: 0,
          outputTokens: 0,
          metadata: expect.objectContaining({ ownershipStatus: 'cross_session' }),
        }),
        expect.objectContaining({
          type: 'answer',
          parentId: 'codex:child-session:parent-turn-2',
          metadata: expect.objectContaining({ ownershipStatus: 'cross_session' }),
        }),
      ]),
    );
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex:child-session:child-turn',
          inputTokens: 9,
          outputTokens: 3,
          model: 'child-model',
        }),
      ]),
    );
  });

  it('uses the exact state-record title instead of agent reasoning text', () => {
    const entries = rollout({ id: 'titled-thread', session_id: 'titled-thread' });
    entries.splice(2, 0, {
      timestamp: '2026-07-26T08:00:01.500Z',
      type: 'event_msg',
      payload: { type: 'agent_reasoning', text: '**This must not become the Session title**' },
    });

    const parsed = parseCodexTranscript(entries, {
      filePath: '/codex/titled-thread.jsonl',
      sourceTitle: '修复 Codex 会话关系',
    });

    expect(parsed?.meta.name).toBe('修复 Codex 会话关系');
  });

  it('keeps a live child turn owned by the child when no task boundary is captured', () => {
    const entries: CodexEntry[] = [
      {
        timestamp: '2026-08-10T06:54:00.000Z',
        type: 'session_meta',
        payload: { id: 'child-session', parent_thread_id: 'parent-session' },
      },
      {
        timestamp: '2026-08-10T06:54:00.001Z',
        type: 'session_meta',
        payload: { id: 'parent-session' },
      },
      {
        timestamp: '2026-08-10T06:54:00.002Z',
        type: 'turn_context',
        payload: { turn_id: 'parent-turn', model: 'parent-model' },
      },
      {
        timestamp: '2026-08-10T06:54:00.003Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 900, output_tokens: 90 } },
        },
      },
      {
        timestamp: '2026-08-10T06:54:00.004Z',
        type: 'turn_context',
        payload: { turn_id: 'child-turn', model: 'child-model' },
      },
      {
        timestamp: '2026-08-10T06:54:00.005Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 9, output_tokens: 3 } },
        },
      },
    ];

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/child-context.jsonl' });
    const spans = parsed?.spans ?? [];
    expect(parsed?.meta.messageCount).toBe(1);
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex:child-session:parent-turn',
          model: undefined,
          inputTokens: 0,
          metadata: expect.objectContaining({ ownershipStatus: 'cross_session' }),
        }),
        expect.objectContaining({
          id: 'codex:child-session:child-turn',
          model: 'child-model',
          inputTokens: 9,
          outputTokens: 3,
        }),
      ]),
    );
  });

  it('keeps a missing source title absent instead of deriving one from reasoning', () => {
    const entries = rollout({ id: 'untitled-thread', session_id: 'untitled-thread' });
    entries.splice(2, 0, {
      timestamp: '2026-07-26T08:00:01.500Z',
      type: 'event_msg',
      payload: { type: 'agent_reasoning', text: '**Do not derive a title**' },
    });

    const parsed = parseCodexTranscript(entries, {
      filePath: '/codex/untitled-thread.jsonl',
    });

    expect(parsed?.meta.name).toBeUndefined();
  });

  it('captures named child-agent call and final callback evidence without retaining callback text', () => {
    const entries = rollout({ id: 'parent-thread', session_id: 'parent-thread' });
    entries.push(
      {
        timestamp: '2026-07-26T08:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'sub_agent_activity',
          kind: 'started',
          event_id: 'call-1',
          occurred_at_ms: 1_785_024_003_000,
          agent_thread_id: 'child-thread',
          agent_path: '/root/lineage_audit',
        },
      },
      {
        timestamp: '2026-07-26T08:00:05.000Z',
        type: 'response_item',
        payload: {
          type: 'agent_message',
          author: '/root/lineage_audit',
          recipient: '/root',
          content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nDone.' }],
        },
      },
    );

    const parsed = parseCodexTranscript(entries, {
      filePath: '/codex/parent-thread.jsonl',
      sourceChildMetadata: {
        'child-thread': {
          agentNickname: 'Lin',
          agentRole: 'audit',
          agentPath: '/root/lineage_audit',
        },
      },
    });

    expect(parsed?.meta.sourceChildLineage).toEqual([
      {
        childSessionId: 'child-thread',
        agentNickname: 'Lin',
        agentRole: 'audit',
        agentPath: '/root/lineage_audit',
        callStartedAt: 1_785_024_003_000,
        callbackAt: Date.parse('2026-07-26T08:00:05.000Z'),
        callbackStatus: 'final_answer',
      },
    ]);
  });

  it('recognizes Codex callback content represented as strings', () => {
    const entries = rollout({ id: 'string-callback-parent', session_id: 'string-callback-parent' });
    entries.push(
      {
        timestamp: '2026-07-26T08:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'sub_agent_activity',
          kind: 'started',
          agent_thread_id: 'string-callback-child',
          agent_path: '/root/string_callback',
        },
      },
      {
        timestamp: '2026-07-26T08:00:05.000Z',
        type: 'response_item',
        payload: {
          type: 'agent_message',
          author: '/root/string_callback',
          content: ['Message Type: FINAL_ANSWER', 'Done.'],
        },
      },
    );

    const parsed = parseCodexTranscript(entries, {
      filePath: '/codex/string-callback-parent.jsonl',
    });

    expect(parsed?.meta.sourceChildLineage?.[0]).toMatchObject({
      childSessionId: 'string-callback-child',
      callbackStatus: 'final_answer',
      callbackAt: Date.parse('2026-07-26T08:00:05.000Z'),
    });
  });

  it('retains an interacted activity as observed callback evidence', () => {
    const entries = rollout({ id: 'interacted-parent', session_id: 'interacted-parent' });
    entries.push({
      timestamp: '2026-07-26T08:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'sub_agent_activity',
        kind: 'interacted',
        occurred_at_ms: 1_785_024_003_000,
        agent_thread_id: 'interacted-child',
        agent_path: '/root/interacted',
      },
    });

    const parsed = parseCodexTranscript(entries, {
      filePath: '/codex/interacted-parent.jsonl',
      sourceChildMetadata: {
        'interacted-child': { agentPath: '/root/interacted' },
      },
    });

    expect(parsed?.meta.sourceChildLineage?.[0]).toMatchObject({
      childSessionId: 'interacted-child',
      callbackAt: 1_785_024_003_000,
      callbackStatus: 'observed',
    });
  });

  it('retains an isolated turn_context as a stub turn with no token telemetry', () => {
    const entries = rollout({ id: 'stub-thread', session_id: 'stub-thread' });
    // 移除 token_count 后，该 turn 只剩 turn_context（source evidence：回合已
    // 开始但没有任何遥测被捕获）。
    entries.splice(2, 1);

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/stub.jsonl' });

    expect(parsed?.spans).toHaveLength(1);
    expect(parsed?.spans[0]).toMatchObject({
      type: 'llm_turn',
      model: 'gpt-5.6-sol',
      inputTokens: 0,
      metadata: {
        tokenUsageSource: 'not_captured',
        tokenUsageClassified: false,
        stubTurn: true,
      },
    });
  });

  it('marks a turn with an unclassified token_count as fallback coverage', () => {
    const parsed = parseCodexTranscript(
      rollout(
        { id: 'unclassified-thread', session_id: 'unclassified-thread' },
        {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 4_096,
        },
      ),
      { filePath: '/codex/unclassified.jsonl' },
    );

    expect(parsed?.spans[0]).toMatchObject({
      inputTokens: 4_096,
      metadata: {
        tokenUsageSource: 'total_tokens_fallback',
        tokenUsageClassified: false,
      },
    });
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

  it('attributes migrated assistant messages to their passthrough turn_id instead of task_started', () => {
    // Codex review-mode rollouts have no turn_context and no token_count. The
    // task_started event names a process turn, while the assistant message
    // carries the real LLM turn in internal_chat_message_metadata_passthrough.
    const entries: CodexEntry[] = [
      {
        timestamp: '2026-08-03T13:25:04.000Z',
        type: 'session_meta',
        payload: { id: 'review-session', session_id: 'review-session' },
      },
      {
        timestamp: '2026-08-03T13:25:04.100Z',
        type: 'event_msg',
        payload: {
          type: 'entered_review_mode',
          turn_id: 'review-process-turn',
        },
      },
      {
        timestamp: '2026-08-03T13:25:04.200Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'process-turn-a2c6',
          started_at: 1_780_000_000,
        },
      },
      {
        timestamp: '2026-08-03T13:25:05.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Review the changes' },
      },
      {
        timestamp: '2026-08-03T14:27:15.900Z',
        type: 'response_item',
        payload: {
          type: 'message',
          id: 'msg-1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'All checks passed.' }],
          internal_chat_message_metadata_passthrough: { turn_id: 'review-process-turn' },
        },
      },
      {
        timestamp: '2026-08-03T14:27:15.905Z',
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'review-process-turn' },
      },
    ];

    const parsed = parseCodexTranscript(entries, { filePath: '/codex/review-mode.jsonl' });

    const answers = parsed?.spans.filter((span) => span.type === 'answer') ?? [];
    expect(answers).toHaveLength(1);
    // answer 必须归属到消息真实 LLM turn，而不是 task_started 的进程 turn。
    expect(answers[0].parentId).toBe('codex:review-session:review-process-turn');
    expect(answers[0].id).toMatch(/^codex:review-session:review-process-turn-answer-/);
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

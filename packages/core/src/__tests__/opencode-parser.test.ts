import { describe, expect, it } from 'vitest';
import { parseOpenCodeSession } from '../parsers/opencode';

describe('OpenCode parser', () => {
  it('keeps session aggregate tokens separate and preserves bounded assistant evidence', () => {
    const parsed = parseOpenCodeSession(
      {
        id: 'open-session',
        title: 'Fixture session',
        directory: '/workspace/project',
        model: JSON.stringify({ providerID: 'opencode', id: 'fixture-model' }),
        agent: 'build',
        tokens_input: 10,
        tokens_cache_write: 2,
        tokens_cache_read: 4,
        tokens_output: 5,
        tokens_reasoning: 3,
        time_created: 100,
        time_updated: 200,
      },
      [
        {
          id: 'assistant-message',
          data: {
            role: 'assistant',
            parentID: 'user-message',
            time: { created: 120, completed: 180 },
          },
          parts: [
            {
              id: 'reasoning',
              data: { type: 'reasoning', text: 'consider options', time: { start: 125, end: 135 } },
            },
            {
              id: 'tool',
              data: {
                type: 'tool',
                callID: 'call-1',
                tool: 'Read',
                state: {
                  status: 'error',
                  input: { path: '/tmp/a' },
                  output: 'not found',
                  time: { start: 140, end: 150 },
                },
              },
            },
            {
              id: 'answer',
              data: { type: 'text', text: 'done', time: { start: 155, end: 175 } },
            },
          ],
        },
      ],
    );

    expect(parsed?.meta).toMatchObject({ agent: 'opencode', messageCount: 1 });
    expect(parsed?.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'open-session:session-aggregate',
          type: 'llm_turn',
          inputTokens: 10,
          cacheCreationTokens: 2,
          cacheReadTokens: 4,
          outputTokens: 8,
          model: 'fixture-model',
          metadata: {
            tokenUsageSource: 'session_aggregate',
            tokenUsageClassified: true,
            sourceOutputTokens: 5,
            sourceReasoningTokens: 3,
            sourceAgent: 'build',
          },
        }),
        expect.objectContaining({
          id: 'open-session:call-1',
          type: 'tool_call',
          parentId: 'open-session:session-aggregate',
          name: 'Read',
          startTime: 140,
          endTime: 150,
          isError: true,
          metadata: expect.objectContaining({
            sourceMessageId: 'assistant-message',
            sourceParentMessageId: 'user-message',
          }),
        }),
        expect.objectContaining({ type: 'thinking', startTime: 125, endTime: 135 }),
        expect.objectContaining({ type: 'answer', startTime: 155, endTime: 175 }),
      ]),
    );
  });

  it('rejects sessions without an assistant message', () => {
    expect(
      parseOpenCodeSession(
        {
          id: 'open-empty',
          title: 'empty',
          directory: '/workspace/project',
          model: null,
          agent: null,
          tokens_input: 0,
          tokens_output: 0,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          time_created: 1,
          time_updated: 2,
        },
        [{ id: 'user', data: { role: 'user' }, parts: [] }],
      ),
    ).toBeNull();
  });
});

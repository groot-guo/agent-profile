import { describe, expect, it } from 'vitest';
import { parseZedThread, type ZedThreadInput } from '../parsers/zed';

function input(folderPaths: string | null = '/workspace/project'): ZedThreadInput {
  return {
    id: 'zed-session',
    summary: 'Zed fixture',
    folderPaths,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:01:00.000Z',
    dataType: 'zstd',
    dataBuffer: Buffer.from(
      JSON.stringify({
        title: 'Zed fixture title',
        model: { provider: 'fixture-provider', model: 'fixture-model' },
        request_token_usage: {
          'request-1': { input_tokens: 120, output_tokens: 30 },
        },
        messages: [
          { User: { id: 'request-1', content: [{ Text: 'private prompt' }] } },
          {
            Agent: {
              content: [
                { Text: 'captured answer' },
                {
                  ToolUse: {
                    id: 'tool-1',
                    name: 'read_file',
                    input: { path: '/workspace/project/file.ts' },
                  },
                },
              ],
              tool_results: {
                'tool-1': {
                  tool_use_id: 'tool-1',
                  tool_name: 'read_file',
                  is_error: false,
                  output: 'file contents',
                },
              },
            },
          },
        ],
      }),
    ),
  };
}

describe('parseZedThread', () => {
  it('maps Zed JSON messages, request usage, tools, and raw folder paths', async () => {
    const parsed = await parseZedThread(input());

    expect(parsed?.meta).toMatchObject({
      cwd: '/workspace/project',
      messageCount: 1,
      agent: 'zed',
    });
    expect(parsed?.spans).toHaveLength(3);
    expect(parsed?.spans[0]).toMatchObject({
      type: 'llm_turn',
      inputTokens: 120,
      outputTokens: 30,
      model: 'fixture-model',
      metadata: { tokenUsageSource: 'request_token_usage' },
    });
    expect(parsed?.spans[1]).toMatchObject({ type: 'answer', parentId: parsed?.spans[0].id });
    expect(parsed?.spans[2]).toMatchObject({
      id: 'tool-1',
      type: 'tool_call',
      name: 'read_file',
      isError: false,
      parentId: parsed?.spans[0].id,
    });
    expect(parsed?.spans[2].outputBytes).toBeGreaterThan(0);
  });

  it('accepts the legacy JSON-array folder path representation', async () => {
    const parsed = await parseZedThread(input('["/workspace/legacy"]'));
    expect(parsed?.meta.cwd).toBe('/workspace/legacy');
  });

  it('rejects unsupported payloads instead of inventing summary tokens', async () => {
    const invalid = input();
    invalid.dataBuffer = Buffer.from('not-json');
    expect(await parseZedThread(invalid)).toBeNull();
  });
});

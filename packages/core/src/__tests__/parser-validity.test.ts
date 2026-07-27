import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../parsers/claude';
import { parseCodexTranscript } from '../parsers/codex';
import { parseMiMoSession } from '../parsers/mimo';

describe('parser validity filtering', () => {
  it('rejects a Claude transcript with metadata but no assistant turn', () => {
    expect(
      parseTranscript(
        [
          {
            uuid: 'metadata-only',
            sessionId: 'claude-empty',
            timestamp: '',
            type: 'mode',
            cwd: '/workspace/project',
          },
        ],
        { filePath: '/claude/metadata-only.jsonl', agent: 'claude-code' },
      ),
    ).toBeNull();
  });

  it('rejects a Codex rollout with session metadata but no usable turn', () => {
    expect(
      parseCodexTranscript(
        [
          {
            timestamp: '2026-07-27T00:00:00.000Z',
            type: 'session_meta',
            payload: { id: 'codex-empty', cwd: '/workspace/project' },
          },
        ],
        { filePath: '/codex/metadata-only.jsonl' },
      ),
    ).toBeNull();
  });

  it('rejects a MiMo session with messages but no assistant turn', () => {
    expect(
      parseMiMoSession(
        {
          id: 'mimo-empty',
          title: 'Metadata only',
          directory: '/workspace/project',
          time_created: 1,
          time_updated: 2,
        },
        [
          {
            id: 'user-message',
            agent_id: 'user',
            data: { role: 'user', time: { created: 1 } },
            parts: [],
          },
        ],
      ),
    ).toBeNull();
  });
});

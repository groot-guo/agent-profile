import type { SessionEvidenceEvent } from '@agent-profile/core';
import { describe, expect, it } from 'vitest';
import { evidencePageUrl, mergeEvidenceEvents, parseEvidenceSpanIds } from './evidence-data';

describe('evidence page data', () => {
  it('builds a query-bound evidence page URL', () => {
    expect(
      evidencePageUrl(
        'http://localhost:3000/api',
        'session / 1',
        { content: 'preview', type: 'tool_call', lane: 'main', outcome: 'observed_error' },
        'cursor/value',
      ),
    ).toBe(
      'http://localhost:3000/api/session/session%20%2F%201/evidence-page?content=preview&type=tool_call&lane=main&outcome=observed_error&cursor=cursor%2Fvalue',
    );
  });

  it('adds a bounded Span focus to the evidence query and parses deep-link IDs', () => {
    expect(
      evidencePageUrl('http://localhost:3000/api', 'session-1', {
        content: 'none',
        type: 'all',
        lane: 'all',
        outcome: 'all',
        spanIds: ['tool-1', 'turn-1'],
      }),
    ).toContain('spanIds=tool-1%2Cturn-1');
    expect(parseEvidenceSpanIds('tool-1,tool-1, bad id,turn-1')).toEqual(['tool-1', 'turn-1']);
    expect(parseEvidenceSpanIds(null)).toEqual([]);
  });

  it('appends cursor pages without duplicating retried events', () => {
    const first = event('one', 1);
    const duplicate = event('one', 1);
    const second = event('two', 2);
    expect(mergeEvidenceEvents([first], [duplicate, second])).toEqual([first, second]);
  });
});

function event(id: string, sequence: number): SessionEvidenceEvent {
  return {
    sequence,
    id,
    parentId: null,
    parentLink: 'root',
    type: 'thinking',
    name: id,
    lane: 'main',
    outcome: 'not_applicable',
    startTime: sequence,
    endTime: null,
    durationMs: null,
    model: null,
    metrics: {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
      outputBytes: 0,
      cost: null,
      costCurrency: null,
    },
    content: { status: 'not_captured', fields: [] },
  };
}

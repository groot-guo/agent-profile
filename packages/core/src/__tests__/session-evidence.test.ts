import { describe, expect, it } from 'vitest';
import {
  buildSessionEvidenceReport,
  MAX_EVIDENCE_PREVIEW_CHARACTERS,
  redactSensitiveText,
  SESSION_EVIDENCE_SCHEMA_VERSION,
} from '../session-evidence';
import type { SessionSummary, Span } from '../types';

describe('session evidence report', () => {
  it('redacts common credentials before applying the content bound', () => {
    const secret = 'sk-supersecret123456789';
    const result = redactSensitiveText(
      `api_key=${secret} Bearer ${'a'.repeat(24)} ${'x'.repeat(80)}`,
      40,
    );

    expect(result.text).not.toContain(secret);
    expect(result.text).not.toContain('Bearer aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.text.length).toBeLessThanOrEqual(41);
    expect(result.redactions).toBeGreaterThanOrEqual(2);
  });

  it('orders every normalized span once and preserves relationships and lanes', () => {
    const spans = [
      makeSpan({
        id: 'tool-side',
        parentId: 'turn-1',
        type: 'tool_call',
        name: 'Read',
        startTime: 120,
        endTime: 140,
        isSidechain: true,
        metadata: { input: '{"file":"a.ts"}', output: 'ok' },
      }),
      makeSpan({ id: 'turn-1', type: 'llm_turn', name: 'model', startTime: 100, endTime: 150 }),
      makeSpan({
        id: 'answer-1',
        parentId: 'missing-user-message',
        type: 'answer',
        name: 'answer',
        startTime: 120,
        metadata: { text: 'done' },
      }),
    ];

    const report = buildSessionEvidenceReport(session(), spans, { generatedAt: 999 });

    expect(report.schemaVersion).toBe(SESSION_EVIDENCE_SCHEMA_VERSION);
    expect(report.generatedAt).toBe(999);
    expect(report.events.map((event) => event.id)).toEqual(['turn-1', 'tool-side', 'answer-1']);
    expect(new Set(report.events.map((event) => event.id)).size).toBe(spans.length);
    expect(report.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(report.events[1]).toMatchObject({
      parentLink: 'linked',
      lane: 'sidechain',
      outcome: 'no_error_observed',
    });
    expect(report.events[2]).toMatchObject({
      parentLink: 'missing_parent',
      endTime: null,
      durationMs: null,
    });
    expect(report.scope.byType).toEqual({
      llm_turn: 1,
      tool_call: 1,
      thinking: 0,
      answer: 1,
    });
  });

  it('reports field coverage without treating missing values as zero or success', () => {
    const report = buildSessionEvidenceReport(session(), [
      makeSpan({
        id: 'turn',
        type: 'llm_turn',
        name: 'model',
        startTime: 100,
        endTime: 110,
        model: 'fixture-model',
      }),
      makeSpan({
        id: 'tool-ok',
        parentId: 'turn',
        type: 'tool_call',
        name: 'Read',
        startTime: 101,
        endTime: 102,
        metadata: { input: '{}' },
      }),
      makeSpan({
        id: 'tool-error',
        parentId: 'turn',
        type: 'tool_call',
        name: 'Bash',
        startTime: 103,
        isError: true,
        metadata: { output: 'failed' },
      }),
    ]);

    expect(report.coverage.toolInputs).toMatchObject({
      observed: 1,
      total: 2,
      coverage: 0.5,
      status: 'partial',
    });
    expect(report.coverage.toolOutputs).toMatchObject({
      observed: 1,
      total: 2,
      status: 'partial',
    });
    expect(report.coverage.timing).toMatchObject({ observed: 2, total: 3, status: 'partial' });
    expect(report.scope.byOutcome).toEqual({
      observed_error: 1,
      no_error_observed: 1,
      not_applicable: 1,
    });
  });

  it('omits content by default and returns only bounded redacted previews when requested', () => {
    const marker = 'raw-private-marker';
    const secret = 'sk-supersecret123456789';
    const longOutput = `${marker} token=${secret} ${'x'.repeat(700)}…[truncated 45 chars]`;
    const spans = [
      makeSpan({
        id: 'tool',
        type: 'tool_call',
        name: 'Bash',
        startTime: 100,
        metadata: { input: `api_key=${secret}`, output: longOutput },
      }),
    ];

    const hidden = buildSessionEvidenceReport(session(), spans);
    expect(JSON.stringify(hidden)).not.toContain(marker);
    expect(JSON.stringify(hidden)).not.toContain(secret);
    expect(hidden.privacy).toMatchObject({
      contentMode: 'none',
      previewCharacters: 0,
      rawContentIncluded: false,
    });

    const preview = buildSessionEvidenceReport(session(), spans, { contentMode: 'preview' });
    const fields = preview.events[0].content.fields;
    expect(fields[0].preview).toContain('[REDACTED');
    expect(fields[0].preview).not.toContain(secret);
    expect(fields[1].preview).toContain(marker);
    expect(fields[1].preview?.length).toBeLessThanOrEqual(MAX_EVIDENCE_PREVIEW_CHARACTERS + 1);
    expect(fields[1].sourceTruncated).toBe(true);
    expect(preview.privacy.rawContentIncluded).toBe(false);
  });

  it('uses not_applicable coverage when a session has no relevant events', () => {
    const report = buildSessionEvidenceReport(session(), []);
    expect(report.scope.events).toBe(0);
    expect(report.coverage.toolInputs.status).toBe('not_applicable');
    expect(report.coverage.modelIdentity.status).toBe('not_applicable');
    expect(report.coverage.tokenUsage.status).toBe('not_applicable');
    expect(report.coverage.content.status).toBe('not_applicable');
  });

  it('distinguishes captured, fallback, and missing token usage on events', () => {
    const report = buildSessionEvidenceReport(session(), [
      makeSpan({
        id: 'turn-captured',
        type: 'llm_turn',
        name: 'model',
        startTime: 100,
        model: 'fixture-model',
        metadata: { tokenUsageSource: 'token_count', tokenUsageClassified: true },
      }),
      makeSpan({
        id: 'turn-fallback',
        type: 'llm_turn',
        name: 'model',
        startTime: 200,
        model: 'fixture-model',
        metadata: { tokenUsageSource: 'total_tokens_fallback', tokenUsageClassified: false },
      }),
      makeSpan({
        id: 'turn-stub',
        type: 'llm_turn',
        name: 'model',
        startTime: 300,
        model: 'fixture-model',
        metadata: {
          tokenUsageSource: 'not_captured',
          tokenUsageClassified: false,
          stubTurn: true,
        },
      }),
      makeSpan({ id: 'tool', type: 'tool_call', name: 'Read', startTime: 400 }),
    ]);

    expect(report.events[0].coverage.tokenUsage).toEqual({
      status: 'captured',
      source: 'token_count',
      classified: true,
      stubTurn: false,
    });
    expect(report.events[1].coverage.tokenUsage).toEqual({
      status: 'captured',
      source: 'total_tokens_fallback',
      classified: false,
      stubTurn: false,
    });
    expect(report.events[2].coverage.tokenUsage).toEqual({
      status: 'not_captured',
      source: 'not_captured',
      classified: false,
      stubTurn: true,
    });
    expect(report.events[3].coverage.tokenUsage.status).toBe('not_applicable');
    expect(report.coverage.tokenUsage).toMatchObject({
      observed: 2,
      total: 3,
      status: 'partial',
    });
  });

  it('preserves ownership states instead of collapsing references into missing parents', () => {
    const report = buildSessionEvidenceReport(session(), [
      makeSpan({
        id: 'cross',
        type: 'llm_turn',
        name: 'cross-session',
        startTime: 100,
        metadata: { ownershipStatus: 'cross_session', sourceSessionId: 'parent-session' },
      }),
      makeSpan({
        id: 'source-user',
        type: 'answer',
        name: 'source-user',
        startTime: 101,
        metadata: { ownershipStatus: 'source_user', text: 'answer' },
      }),
      makeSpan({
        id: 'corrupt',
        type: 'thinking',
        name: 'corrupt',
        startTime: 102,
        metadata: { ownershipStatus: 'corrupted_ownership' },
      }),
      makeSpan({
        id: 'not-captured',
        type: 'answer',
        name: 'not-captured',
        startTime: 103,
        metadata: { ownershipStatus: 'not_captured', text: 'answer' },
      }),
    ]);

    expect(report.events.map((event) => event.parentLink)).toEqual([
      'cross_session',
      'source_user',
      'corrupted_ownership',
      'not_captured',
    ]);
  });
});

function session(): Pick<SessionSummary, 'id' | 'name' | 'agent' | 'startTime' | 'endTime'> {
  return {
    id: 'session-1',
    name: 'Fixture',
    agent: 'codex',
    startTime: 100,
    endTime: 200,
  };
}

function makeSpan(
  overrides: Partial<Span> & Pick<Span, 'id' | 'type' | 'name' | 'startTime'>,
): Span {
  const { id, type, name, startTime, ...rest } = overrides;
  return {
    id,
    sessionId: 'session-1',
    parentId: null,
    type,
    name,
    startTime,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    outputBytes: 0,
    cost: 0,
    costUnknown: false,
    costStatus: 'unknown_pricing',
    isError: false,
    isSidechain: false,
    ...rest,
  };
}

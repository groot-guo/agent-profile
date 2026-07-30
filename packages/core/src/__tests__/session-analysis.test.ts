import { describe, expect, it } from 'vitest';
import {
  buildSessionAnalysisWindows,
  MAX_ANALYSIS_CONTEXT_POINTS,
  MAX_ANALYSIS_SIDECHAIN_TURNS,
  MAX_ANALYSIS_TOOL_EVENTS,
} from '../session-analysis';
import type { Span } from '../types';

describe('session analysis windows', () => {
  it('keeps exact aggregates while bounding response windows', () => {
    const turns = Array.from({ length: 300 }, (_, index) =>
      span({
        id: `turn-${index}`,
        type: 'llm_turn',
        name: `turn-${index}`,
        startTime: index,
        inputTokens: index === 151 ? 50_000 : 100 + index,
        contextTokens: index === 151 ? 50_000 : 100 + index,
        outputTokens: 10,
        model: 'fixture-model',
      }),
    );
    const tools = Array.from({ length: 120 }, (_, index) =>
      span({
        id: `tool-${index}`,
        type: 'tool_call',
        name: index % 2 === 0 ? 'Read' : 'Bash',
        startTime: 1_000 + index,
        endTime: 1_010 + index,
        outputBytes: index,
        isError: index % 10 === 0,
      }),
    );
    const sidechainTurns = Array.from({ length: 25 }, (_, index) =>
      span({
        id: `side-${index}`,
        type: 'llm_turn',
        name: `subtask-${index}`,
        startTime: 2_000 + index,
        inputTokens: 20,
        cacheReadTokens: 30,
        outputTokens: 5,
        contextTokens: 50,
        cost: 0.01,
        isSidechain: true,
        metadata: { thinking: 'must-not-leak' },
      }),
    );

    const result = buildSessionAnalysisWindows(
      [...turns, ...tools, ...sidechainTurns],
      () => 200_000,
    );

    expect(result.summary).toMatchObject({
      events: 445,
      llmTurns: 325,
      mainToolCalls: 120,
      sidechainToolCalls: 0,
      observedToolErrors: 12,
      sidechain: {
        turns: 25,
        tools: 0,
        tokens: 1_375,
      },
    });
    expect(result.summary.sidechain.cost).toBeCloseTo(0.25);
    expect(result.summary.toolNames).toEqual([
      { name: 'Bash', count: 60 },
      { name: 'Read', count: 60 },
    ]);
    expect(result.summary.toolErrors).toEqual([{ name: 'Read', total: 60, errors: 12 }]);
    expect(result.context.total).toBe(325);
    expect(result.context.points).toHaveLength(MAX_ANALYSIS_CONTEXT_POINTS);
    expect(result.context.isSampled).toBe(true);
    expect(result.context.points[0].startTime).toBe(0);
    expect(result.context.points.at(-1)?.startTime).toBe(2_024);
    expect(result.context.points.some((point) => point.contextTokens === 50_000)).toBe(true);
    expect(result.toolWindow.total).toBe(120);
    expect(result.toolWindow.events).toHaveLength(MAX_ANALYSIS_TOOL_EVENTS);
    expect(result.toolWindow.events[0].id).toBe('tool-70');
    expect(result.sidechainTurnWindow.total).toBe(25);
    expect(result.sidechainTurnWindow.events).toHaveLength(MAX_ANALYSIS_SIDECHAIN_TURNS);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('returns complete windows when the Session is below every limit', () => {
    const spans = [
      span({ id: 'turn', type: 'llm_turn', name: 'turn', startTime: 1, contextTokens: 10 }),
      span({ id: 'tool', type: 'tool_call', name: 'Read', startTime: 2 }),
    ];

    const result = buildSessionAnalysisWindows(spans, () => undefined);

    expect(result.context).toMatchObject({ total: 1, isSampled: false });
    expect(result.toolWindow).toMatchObject({ total: 1, isWindowed: false });
    expect(result.sidechainTurnWindow).toMatchObject({ total: 0, isWindowed: false });
  });
});

function span(overrides: Partial<Span> & Pick<Span, 'id' | 'type' | 'name' | 'startTime'>): Span {
  return {
    sessionId: 'session-1',
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    outputBytes: 0,
    cost: 0,
    costUnknown: false,
    isError: false,
    isSidechain: false,
    ...overrides,
  };
}

import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import {
  appendRuntimeEventBatch,
  getRuntimeEventPage,
  RuntimeEventCollectorError,
} from '../runtime-event-collector';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('runtime event collector', () => {
  it('stores bounded events idempotently and preserves sequence ordering', () => {
    const database = createDatabase(':memory:');
    databases.push(database);

    const first = appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [event(2, 'tool_result', { status: 'observed' }), event(1, 'run_started')],
    });
    expect(first).toMatchObject({
      accepted: 2,
      duplicates: 0,
      rejected: [],
      coverage: { observed: 2, total: 2, status: 'complete' },
      ordering: { outOfOrderAccepted: 1 },
    });

    const duplicate = appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [event(2, 'tool_result', { status: 'observed' })],
    });
    expect(duplicate).toMatchObject({
      accepted: 0,
      duplicates: 1,
      coverage: { status: 'complete' },
    });

    const conflict = appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [event(2, 'tool_call')],
    });
    expect(conflict.rejected).toEqual([{ eventId: 'event-2', reason: 'event_id_conflict' }]);

    const sequenceConflict = appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [event(3, 'turn_started', undefined, 1)],
    });
    expect(sequenceConflict.rejected).toEqual([
      { eventId: 'event-3', reason: 'sequence_conflict' },
    ]);

    const page = getRuntimeEventPage(database, 'run-1', 10);
    expect(page).toMatchObject({
      schemaVersion: 'runtime-event-page/v1',
      taskId: 'task-1',
      total: 2,
      hasMore: false,
    });
    expect(page.events.map((item) => item.sequence)).toEqual([1, 2]);
    expect(page.events[1]?.payloadFields).toEqual(['status']);
    expect(JSON.stringify(page)).not.toContain('private');
  });

  it('rejects raw-content payload keys and invalid batches without partial writes', () => {
    const database = createDatabase(':memory:');
    databases.push(database);

    expect(() =>
      appendRuntimeEventBatch(database, {
        schemaVersion: 'runtime-event-batch/v1',
        events: [event(1, 'tool_call', { input: 'private' } as never)],
      }),
    ).toThrowError(new RuntimeEventCollectorError('invalid_event'));
    expect(database.prepare('SELECT COUNT(*) as count FROM runtime_events').get()).toEqual({
      count: 0,
    });
    expect(() => getRuntimeEventPage(database, 'run-1', 0)).toThrowError(
      new RuntimeEventCollectorError('invalid_limit'),
    );
  });
});

function event(
  sequence: number,
  kind: 'run_started' | 'tool_call' | 'tool_result' | 'turn_started',
  payload?: Record<string, unknown>,
  actualSequence = sequence,
) {
  return {
    schemaVersion: 'runtime-event/v1' as const,
    eventId: `event-${sequence}`,
    taskId: 'task-1',
    runId: 'run-1',
    sequence: actualSequence,
    capturedAt: 1_800_000_000_000 + sequence,
    kind,
    payload,
  };
}

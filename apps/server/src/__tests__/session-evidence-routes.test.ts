import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerSessionEvidenceRoutes } from '../routes/session-evidence';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('session evidence route', () => {
  it('returns every normalized event without content by default', async () => {
    const { app, database } = createApp();
    insertFixture(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/evidence',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'session-evidence/v1',
      scope: {
        events: 3,
        byType: { llm_turn: 1, tool_call: 1, thinking: 1, answer: 0 },
      },
      privacy: {
        contentMode: 'none',
        previewCharacters: 0,
        secretRedaction: true,
        rawContentIncluded: false,
      },
    });
    expect(response.body).not.toContain('private-command-marker');
    expect(response.body).not.toContain('supersecret');
    await app.close();
  });

  it('returns bounded redacted previews only when explicitly requested', async () => {
    const { app, database } = createApp();
    insertFixture(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/evidence?content=preview',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('private-command-marker');
    expect(response.body).toContain('[REDACTED');
    expect(response.body).not.toContain('sk-supersecret123456');
    expect(response.json().privacy).toMatchObject({
      contentMode: 'preview',
      previewCharacters: 500,
      rawContentIncluded: false,
    });
    await app.close();
  });

  it('validates preview mode and returns 404 for an unknown session', async () => {
    const { app } = createApp();
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/session/missing/evidence?content=full',
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/session/missing/evidence',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'session not found' });
    await app.close();
  });

  it('pages every stored event with stable global sequence and bounded defaults', async () => {
    const { app, database } = createApp();
    insertPagedFixture(database, 205);

    const firstResponse = await app.inject({
      method: 'GET',
      url: '/api/session/paged-session/evidence-page',
    });

    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json();
    expect(first).toMatchObject({
      schemaVersion: 'session-evidence-page/v1',
      counts: { matched: 205, total: 205 },
      page: { limit: 80, returned: 80, hasMore: true },
      privacy: { contentMode: 'none', previewCharacters: 0 },
    });
    expect(first.events).toHaveLength(80);
    expect(first.events[0].sequence).toBe(1);
    expect(first.events.at(-1).sequence).toBe(80);
    expect(firstResponse.body).not.toContain('page-secret-marker');

    const secondResponse = await app.inject({
      method: 'GET',
      url: `/api/session/paged-session/evidence-page?cursor=${encodeURIComponent(first.page.nextCursor)}`,
    });
    expect(secondResponse.statusCode).toBe(200);
    const second = secondResponse.json();
    expect(second.events).toHaveLength(80);
    expect(second.events[0].sequence).toBe(81);
    expect(second.events.at(-1).sequence).toBe(160);

    const thirdResponse = await app.inject({
      method: 'GET',
      url: `/api/session/paged-session/evidence-page?cursor=${encodeURIComponent(second.page.nextCursor)}`,
    });
    expect(thirdResponse.statusCode).toBe(200);
    const third = thirdResponse.json();
    expect(third.page).toMatchObject({ returned: 45, hasMore: false, nextCursor: null });
    expect(third.events[0].sequence).toBe(161);
    expect(third.events.at(-1).sequence).toBe(205);
    expect(
      new Set([...first.events, ...second.events, ...third.events].map((event) => event.id)).size,
    ).toBe(205);
    await app.close();
  });

  it('applies server-side filters while preserving full-session parent and coverage evidence', async () => {
    const { app, database } = createApp();
    insertPagedFixture(database, 12);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/paged-session/evidence-page?type=thinking&lane=main&limit=1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.query).toMatchObject({ type: 'thinking', lane: 'main', outcome: 'all' });
    expect(body.counts).toEqual({ matched: 2, total: 12 });
    expect(body.scope.events).toBe(12);
    expect(body.page).toMatchObject({ limit: 1, returned: 1, hasMore: true });
    expect(body.events.every((event: { type: string }) => event.type === 'thinking')).toBe(true);
    expect(body.events[0].sequence).toBeGreaterThan(1);
    expect(body.events[0].parentLink).toBe('linked');
    expect(body.coverage.parentLinks.total).toBeGreaterThan(0);
    await app.close();
  });

  it('binds cursors to filters and validates limits', async () => {
    const { app, database } = createApp();
    insertPagedFixture(database, 12);

    const first = await app.inject({
      method: 'GET',
      url: '/api/session/paged-session/evidence-page?type=tool_call&limit=1',
    });
    const cursor = first.json().page.nextCursor;
    const mismatch = await app.inject({
      method: 'GET',
      url: `/api/session/paged-session/evidence-page?type=thinking&limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toEqual({ error: 'evidence cursor does not match query' });

    const tooLarge = await app.inject({
      method: 'GET',
      url: '/api/session/paged-session/evidence-page?limit=201',
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json()).toEqual({ error: 'invalid evidence limit' });
    await app.close();
  });

  it('loads and redacts preview content only for the current page window', async () => {
    const { app, database } = createApp();
    insertPreviewWindowFixture(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/preview-session/evidence-page?content=preview&type=tool_call&limit=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('first-page-marker');
    expect(response.body).toContain('[REDACTED');
    expect(response.body).not.toContain('sk-firstsecret123456');
    expect(response.body).not.toContain('second-page-marker');
    expect(response.json().events[0].content.fields[0]).toMatchObject({
      name: 'input',
      status: 'available',
    });
    await app.close();
  });

  it('treats malformed metadata as not captured without loading it into the response', async () => {
    const { app, database } = createApp();
    insertFixture(database);
    database
      .prepare("UPDATE spans SET metadata = ? WHERE id = 'tool-1'")
      .run('{malformed:private-marker');

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/evidence-page?type=tool_call',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events[0].content).toEqual({
      status: 'not_captured',
      fields: [
        { name: 'input', status: 'not_captured', sourceTruncated: false },
        { name: 'output', status: 'not_captured', sourceTruncated: false },
      ],
    });
    expect(response.body).not.toContain('private-marker');
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const app = Fastify({ logger: false });
  registerSessionEvidenceRoutes(app, {
    database,
  });
  return { app, database };
}

function insertFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cost_unknown_count, total_cost, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.1, 0.5, ?, ?)`,
    )
    .run('session-1', 'fixture://session-1', 'codex', 100, 200, 1000, 500, 300);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, end_time, model, metadata
      ) VALUES (?, ?, 'llm_turn', 'fixture', 100, 190, 'fixture-model', NULL)`,
    )
    .run('turn-1', 'session-1');
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, parent_id, type, name, start_time, end_time,
        output_bytes, is_error, metadata
      ) VALUES (?, ?, ?, 'tool_call', 'Bash', 120, 140, 24, 0, ?)`,
    )
    .run(
      'tool-1',
      'session-1',
      'turn-1',
      JSON.stringify({
        input: 'private-command-marker api_key=sk-supersecret123456',
        output: 'done',
      }),
    );
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, parent_id, type, name, start_time, metadata
      ) VALUES (?, ?, ?, 'thinking', 'reasoning', 121, ?)`,
    )
    .run(
      'thinking-1',
      'session-1',
      'turn-1',
      JSON.stringify({ thinking: 'token=sk-supersecret123456' }),
    );
}

function insertPagedFixture(database: DatabaseConnection, count: number): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cost_unknown_count, total_cost, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.1, 0.5, ?, ?)`,
    )
    .run('paged-session', 'fixture://paged-session', 'codex', 100, 500, 1000, 500, 300);
  const insert = database.prepare(
    `INSERT INTO spans (
      id, session_id, parent_id, type, name, start_time, end_time, is_error,
      is_sidechain, metadata
    ) VALUES (?, 'paged-session', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const types = ['llm_turn', 'tool_call', 'thinking', 'answer'] as const;
  for (let index = 0; index < count; index++) {
    const type = types[index % types.length];
    insert.run(
      `event-${String(index).padStart(3, '0')}`,
      index === 0 ? null : 'event-000',
      type,
      `${type}-${index}`,
      100 + Math.floor(index / 3),
      101 + Math.floor(index / 3),
      type === 'tool_call' && index % 8 === 1 ? 1 : 0,
      index % 5 === 0 ? 1 : 0,
      type === 'tool_call'
        ? JSON.stringify({ input: `page-secret-marker-${index}`, output: 'ok' })
        : type === 'thinking'
          ? JSON.stringify({ thinking: `thought-${index}` })
          : type === 'answer'
            ? JSON.stringify({ text: `answer-${index}` })
            : null,
    );
  }
}

function insertPreviewWindowFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cost_unknown_count, total_cost, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.1, 0.5, ?, ?)`,
    )
    .run('preview-session', 'fixture://preview-session', 'codex', 100, 200, 1000, 500, 300);
  const insert = database.prepare(
    `INSERT INTO spans (
      id, session_id, type, name, start_time, end_time, metadata
    ) VALUES (?, 'preview-session', 'tool_call', 'Bash', ?, ?, ?)`,
  );
  insert.run(
    'preview-1',
    100,
    110,
    JSON.stringify({ input: 'first-page-marker api_key=sk-firstsecret123456', output: 'ok' }),
  );
  insert.run(
    'preview-2',
    120,
    130,
    JSON.stringify({ input: 'second-page-marker token=sk-secondsecret123456', output: 'ok' }),
  );
}

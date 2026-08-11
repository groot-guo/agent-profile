import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { buildProfileReport } from '../routes/profiles';
import { buildHomeStatistics, buildStatsReport } from '../routes/stats';

describe('project-scoped reports', () => {
  const databases: ReturnType<typeof createDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('keeps Home, Stats, and Agent Profile aggregates inside the selected root', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    for (const [id, cwd] of [
      ['inside', '/workspace/project/src'],
      ['outside', '/workspace/other'],
    ] as const) {
      database
        .prepare(
          `INSERT INTO sessions (
            id, file_path, agent, start_time, imported_at, cwd,
            input_tokens, output_tokens, total_cost, cost_status
          ) VALUES (?, ?, 'fixture', 1, 1, ?, 10, 2, 0, 'complete')`,
        )
        .run(id, `fixture://${id}`, cwd);
    }

    expect(buildHomeStatistics(database, '/workspace/project').overview.totalSessions).toBe(1);
    expect(buildStatsReport(database, '/workspace/project').overview.totalSessions).toBe(1);
    expect(buildProfileReport(database, 1, '/workspace/project').scope.sessions).toBe(1);
  });
});

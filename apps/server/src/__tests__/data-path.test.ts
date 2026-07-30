import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultApplicationDataDirectory, defaultDatabasePathFor } from '../data-path';
import { createProductionRuntime } from '../runtime';

describe('application data paths', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses the platform user data directory instead of the installation tree', () => {
    expect(
      defaultApplicationDataDirectory({
        platform: 'darwin',
        homeDirectory: '/Users/tester',
        env: {},
      }),
    ).toBe('/Users/tester/Library/Application Support/agent-profile');
    expect(
      defaultApplicationDataDirectory({
        platform: 'linux',
        homeDirectory: '/home/tester',
        env: {},
      }),
    ).toBe('/home/tester/.local/share/agent-profile');
    expect(
      defaultApplicationDataDirectory({
        platform: 'win32',
        homeDirectory: 'C:\\Users\\tester',
        env: { LOCALAPPDATA: 'D:\\LocalData' },
      }),
    ).toBe('D:\\LocalData\\agent-profile');
  });

  it('honors XDG_DATA_HOME on Linux and appends the database filename', () => {
    const options = {
      platform: 'linux' as const,
      homeDirectory: '/home/tester',
      env: { XDG_DATA_HOME: '/state/data' },
    };

    expect(defaultApplicationDataDirectory(options)).toBe('/state/data/agent-profile');
    expect(defaultDatabasePathFor(options)).toBe('/state/data/agent-profile/trace.db');
  });
  it('creates a selected data directory before opening the production database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-profile-data-path-'));
    temporaryDirectories.push(root);
    const databasePath = join(root, 'nested', 'state', 'trace.db');

    const runtime = createProductionRuntime({
      databasePath,
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    await runtime.close();

    expect(existsSync(databasePath)).toBe(true);
  });
});

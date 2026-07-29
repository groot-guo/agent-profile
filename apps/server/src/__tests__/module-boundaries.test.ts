import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../../..');

describe('module boundary rules', () => {
  it('passes the repository boundary checker from a package working directory', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [resolve(repositoryRoot, 'scripts/check-module-boundaries.mjs')],
        {
          cwd: resolve(repositoryRoot, 'apps/server'),
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });

  it('rejects database constructor imports even in Runtime-exempt route files', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-profile-boundary-'));
    try {
      const contractsDirectory = join(fixtureRoot, 'packages/contracts/src');
      const routesDirectory = join(fixtureRoot, 'apps/server/src/routes');
      mkdirSync(contractsDirectory, { recursive: true });
      mkdirSync(routesDirectory, { recursive: true });
      writeFileSync(join(contractsDirectory, 'index.ts'), 'export {};\n');
      writeFileSync(
        join(routesDirectory, 'health.ts'),
        `import { createDatabase } from '../database';
import type { AppRuntime } from '../runtime';
export function registerBadRoute(runtime: AppRuntime) {
  return runtime.database === createDatabase(':memory:');
}
`,
      );

      expect(() =>
        execFileSync(
          process.execPath,
          [resolve(repositoryRoot, 'scripts/check-module-boundaries.mjs'), fixtureRoot],
          { stdio: 'pipe' },
        ),
      ).toThrow();
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

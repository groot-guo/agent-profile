import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const packageRoot = resolve(import.meta.dirname, '..');
const outputFile = resolve(packageRoot, 'dist/agent-profile.mjs');
await mkdir(resolve(packageRoot, 'dist'), { recursive: true });
await build({
  entryPoints: [resolve(packageRoot, 'src/bin.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'bundle',
  external: ['better-sqlite3'],
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
await chmod(outputFile, 0o755);

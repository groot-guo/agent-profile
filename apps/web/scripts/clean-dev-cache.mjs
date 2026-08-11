import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  developmentCacheLockName,
  developmentDistDir,
  developmentTsconfigPath,
  parseDevInvocation,
} from './dev-paths.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const { port } = parseDevInvocation(args.filter((argument) => argument !== '--confirm'));
const distDir = developmentDistDir(port, process.env.NEXT_DEV_DIST_DIR);
const cachePath = resolve(webRoot, distDir);
const lockPath = resolve(webRoot, developmentCacheLockName(distDir));
const tsconfigPath = resolve(webRoot, developmentTsconfigPath(distDir));

if (!confirmed) {
  throw new Error('Refusing to remove a development cache without --confirm');
}
if (existsSync(lockPath) && isLockActive(lockPath)) {
  throw new Error(`Development cache is in use: ${lockPath}`);
}

rmSync(cachePath, { recursive: true, force: true });
rmSync(lockPath, { force: true });
rmSync(tsconfigPath, { force: true });
process.stdout.write(`Removed ${cachePath} and ${tsconfigPath}\n`);

function isLockActive(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(value?.pid)) return false;
    process.kill(value.pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

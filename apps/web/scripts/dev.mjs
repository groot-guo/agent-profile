import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  developmentCacheLockName,
  developmentDistDir,
  developmentTsconfigPath,
  parseDevInvocation,
} from './dev-paths.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { port, nextArgs } = parseDevInvocation(process.argv.slice(2));
const distDir = developmentDistDir(port, process.env.NEXT_DEV_DIST_DIR);
const lockPath = resolve(webRoot, developmentCacheLockName(distDir));
const tsconfigPath = developmentTsconfigPath(distDir);

acquireLock(lockPath);
prepareTsconfig(resolve(webRoot, tsconfigPath), distDir);
process.once('exit', () => rmSync(lockPath, { force: true }));

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(
  command,
  ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(port), ...nextArgs],
  {
    cwd: webRoot,
    env: { ...process.env, NEXT_DEV_DIST_DIR: distDir },
    stdio: 'inherit',
  },
);

let isClosing = false;
const signals = ['SIGINT', 'SIGTERM'];
const forwardSignal = (signal) => {
  if (isClosing) return;
  isClosing = true;
  child.kill(signal);
};
for (const signal of signals) process.once(signal, () => forwardSignal(signal));

child.once('error', (error) => {
  process.stderr.write(`Unable to start Next development server: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code) => {
  rmSync(lockPath, { force: true });
  process.exitCode = code ?? 1;
});

function acquireLock(path) {
  try {
    const descriptor = openSync(path, 'wx');
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
    closeSync(descriptor);
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const existingPid = readLockPid(path);
  if (existingPid && isRunning(existingPid)) {
    throw new Error(`Development cache is already in use by PID ${existingPid}: ${path}`);
  }
  rmSync(path, { force: true });
  acquireLock(path);
}

function readLockPid(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return Number.isInteger(value?.pid) ? value.pid : undefined;
  } catch {
    return undefined;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function prepareTsconfig(path, cacheDir) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          plugins: [{ name: 'next' }],
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', `${cacheDir}/types/**/*.ts`],
      },
      null,
      2,
    )}\n`,
  );
}

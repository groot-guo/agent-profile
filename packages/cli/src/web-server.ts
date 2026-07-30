import { type SpawnOptions, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { WebServerHandle } from './serve';

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 100;
const STOP_TIMEOUT_MS = 5_000;
const STDERR_LIMIT = 16_384;

export interface WebServerProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stderr: Readable | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  once: (
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => unknown;
}

export interface NextWebServerOptions {
  entryPath: string;
  port: number;
  timeoutMs?: number;
}

export interface NextWebServerDependencies {
  fileExists: (path: string) => boolean;
  spawnProcess: (command: string, args: string[], options: SpawnOptions) => WebServerProcess;
  requestReady: (url: string) => Promise<boolean>;
  delay: (milliseconds: number) => Promise<void>;
  now: () => number;
}

export interface ResolveWebServerEntryOptions {
  moduleUrl: string;
  explicitPath?: string;
  fileExists?: (path: string) => boolean;
}

export function resolveWebServerEntry(options: ResolveWebServerEntryOptions): string {
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [
    options.explicitPath ? resolve(options.explicitPath) : undefined,
    fileURLToPath(new URL('../web/apps/web/server.js', options.moduleUrl)),
    fileURLToPath(new URL('../web/server.js', options.moduleUrl)),
    fileURLToPath(
      new URL('../../../apps/web/.next/standalone/apps/web/server.js', options.moduleUrl),
    ),
    fileURLToPath(new URL('../../../apps/web/.next/standalone/server.js', options.moduleUrl)),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(fileExists) ?? candidates[0];
}

export async function startNextWebServer(
  options: NextWebServerOptions,
  dependencies: NextWebServerDependencies = defaultDependencies(),
): Promise<WebServerHandle> {
  if (!dependencies.fileExists(options.entryPath)) {
    throw new Error(`Next standalone server not found: ${options.entryPath}`);
  }

  const url = `http://127.0.0.1:${options.port}`;
  const child = dependencies.spawnProcess(process.execPath, [options.entryPath], {
    cwd: dirname(options.entryPath),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(options.port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (stderr.length >= STDERR_LIMIT) return;
    stderr += String(chunk).slice(0, STDERR_LIMIT - stderr.length);
  });

  try {
    await waitUntilReady(url, child, stderrText, options.timeoutMs, dependencies);
  } catch (error) {
    await stopProcess(child, dependencies);
    throw error;
  }

  let isClosed = false;
  return {
    url,
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      await stopProcess(child, dependencies);
    },
  };

  function stderrText(): string {
    return stderr.trim();
  }
}

async function waitUntilReady(
  url: string,
  child: WebServerProcess,
  stderrText: () => string,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  dependencies: NextWebServerDependencies,
): Promise<void> {
  const startedAt = dependencies.now();
  while (dependencies.now() - startedAt <= timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await dependencies.delay(0);
      const details = stderrText();
      throw new Error(details || 'Next standalone server exited before readiness');
    }
    if (await dependencies.requestReady(url)) return;
    await dependencies.delay(READY_POLL_INTERVAL_MS);
  }
  throw new Error(`Next standalone server did not become ready within ${timeoutMs}ms`);
}

async function stopProcess(
  child: WebServerProcess,
  dependencies: NextWebServerDependencies,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
  });
  child.kill('SIGTERM');
  await Promise.race([exited, dependencies.delay(STOP_TIMEOUT_MS)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

function defaultDependencies(): NextWebServerDependencies {
  return {
    fileExists: existsSync,
    spawnProcess: (command, args, options) => spawn(command, args, options),
    requestReady: async (url) => {
      try {
        const response = await fetch(url, { redirect: 'manual' });
        return response.status >= 200 && response.status < 500;
      } catch {
        return false;
      }
    },
    delay: (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    now: () => Date.now(),
  };
}

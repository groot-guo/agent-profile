import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { resolveWebServerEntry, startNextWebServer, type WebServerProcess } from './web-server';

class FakeProcess extends EventEmitter implements WebServerProcess {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stderr = new PassThrough();
  kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.signalCode = signal;
    this.exitCode = signal === 'SIGKILL' ? 137 : 0;
    this.emit('exit', this.exitCode, signal);
    return true;
  });
}

describe('Next standalone Web process', () => {
  it('resolves an explicit entry before packaged and workspace candidates', () => {
    const existing = new Set(['/explicit/server.js', '/package/web/server.js']);
    expect(
      resolveWebServerEntry({
        moduleUrl: 'file:///package/dist/main.js',
        explicitPath: '/explicit/server.js',
        fileExists: (path) => existing.has(path),
      }),
    ).toBe('/explicit/server.js');
  });

  it('waits for readiness and terminates only the managed child process', async () => {
    const child = new FakeProcess();
    const spawnProcess = vi.fn(() => child);
    const readiness = [false, true];
    const handle = await startNextWebServer(
      { entryPath: '/release/web/server.js', port: 4101, timeoutMs: 1000 },
      {
        fileExists: () => true,
        spawnProcess,
        requestReady: vi.fn(async () => readiness.shift() ?? true),
        delay: vi.fn(async () => undefined),
        now: (() => {
          let now = 0;
          return () => (now += 10);
        })(),
      },
    );

    expect(handle.url).toBe('http://127.0.0.1:4101');
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      ['/release/web/server.js'],
      expect.objectContaining({
        cwd: '/release/web',
        env: expect.objectContaining({ PORT: '4101', HOSTNAME: '127.0.0.1' }),
      }),
    );

    await handle.close();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reports an early standalone process failure without leaking unlimited stderr', async () => {
    const child = new FakeProcess();

    await expect(
      startNextWebServer(
        { entryPath: '/release/web/server.js', port: 4101, timeoutMs: 1000 },
        {
          fileExists: () => true,
          spawnProcess: () => {
            queueMicrotask(() => child.stderr.write('standalone failed'));
            child.exitCode = 1;
            return child;
          },
          requestReady: vi.fn(async () => false),
          delay: vi.fn(async () => undefined),
          now: () => 1,
        },
      ),
    ).rejects.toThrow('standalone failed');
  });
});

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  installShutdownHandlers,
  type LocalApplicationDependencies,
  startLocalApplication,
} from './serve';

function createDependencies(): LocalApplicationDependencies & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    startWebServer: vi.fn(async ({ port }) => {
      events.push(`web:start:${port}`);
      return {
        url: `http://127.0.0.1:${port}`,
        close: vi.fn(async () => {
          events.push('web:close');
        }),
      };
    }),
    createRuntime: vi.fn(() => ({
      imports: {
        startStartupImports: vi.fn(async () => {
          events.push('imports:start');
        }),
      },
      close: vi.fn(async () => {
        events.push('runtime:close');
      }),
    })),
    startHttpServer: vi.fn(async ({ port, webUpstream }) => {
      events.push(`http:start:${port}:${webUpstream}`);
      return {
        close: vi.fn(async () => {
          events.push('http:close');
        }),
      };
    }),
    openBrowser: vi.fn(async (url) => {
      events.push(`browser:${url}`);
    }),
  };
}

describe('local application serve lifecycle', () => {
  it('starts the private Web process before the public HTTP entry point and closes cleanly', async () => {
    const dependencies = createDependencies();
    const application = await startLocalApplication(
      {
        databasePath: '/state/trace.db',
        defaultScanDir: '~/.claude/projects',
        host: '127.0.0.1',
        port: 4100,
        webPort: 4101,
        openBrowser: true,
      },
      dependencies,
    );

    expect(application.report).toEqual({
      url: 'http://127.0.0.1:4100',
      apiUrl: 'http://127.0.0.1:4100/api',
      databasePath: '/state/trace.db',
      host: '127.0.0.1',
      port: 4100,
    });
    expect(dependencies.events).toEqual([
      'web:start:4101',
      'http:start:4100:http://127.0.0.1:4101',
      'imports:start',
      'browser:http://127.0.0.1:4100',
    ]);

    await application.close();
    await application.close();
    expect(dependencies.events.slice(-3)).toEqual(['http:close', 'runtime:close', 'web:close']);
  });

  it('closes once on SIGINT or SIGTERM and records shutdown failures', async () => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    installShutdownHandlers(
      { report: {} as never, close },
      {
        once: (signal, listener) => signals.once(signal, listener),
        off: (signal, listener) => signals.off(signal, listener),
        writeStderr,
        setExitCode,
      },
    );

    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(writeStderr).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('closes already-started resources when public HTTP startup fails', async () => {
    const dependencies = createDependencies();
    dependencies.startHttpServer = vi.fn(async () => {
      throw new Error('port unavailable');
    });

    await expect(
      startLocalApplication(
        {
          databasePath: '/state/trace.db',
          defaultScanDir: '~/.claude/projects',
          host: '127.0.0.1',
          port: 4100,
          webPort: 4101,
          openBrowser: false,
        },
        dependencies,
      ),
    ).rejects.toThrow('port unavailable');
    expect(dependencies.events).toEqual(['web:start:4101', 'runtime:close', 'web:close']);
  });
});

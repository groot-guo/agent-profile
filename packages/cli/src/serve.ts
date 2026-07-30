export interface LocalApplicationOptions {
  databasePath: string;
  defaultScanDir: string;
  host: string;
  port: number;
  webPort: number;
  openBrowser: boolean;
}

export interface WebServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface ServeRuntime {
  imports: {
    startStartupImports: () => Promise<unknown>;
  };
  close: () => Promise<void>;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
}

export interface LocalApplicationDependencies {
  startWebServer: (options: { port: number }) => Promise<WebServerHandle>;
  createRuntime: (options: {
    databasePath: string;
    autoScanDir: string;
    defaultScanDir: string;
  }) => ServeRuntime;
  startHttpServer: (options: {
    runtime: ServeRuntime;
    host: string;
    port: number;
    webUpstream: string;
  }) => Promise<HttpServerHandle>;
  openBrowser: (url: string) => Promise<void>;
}

export interface LocalApplicationReport {
  url: string;
  apiUrl: string;
  databasePath: string;
  host: string;
  port: number;
}

export interface LocalApplicationHandle {
  report: LocalApplicationReport;
  close: () => Promise<void>;
}

export interface ShutdownHandlerDependencies {
  once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
  off: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
  writeStderr: (text: string) => void;
  setExitCode: (exitCode: number) => void;
}

export function installShutdownHandlers(
  application: LocalApplicationHandle,
  dependencies: ShutdownHandlerDependencies,
): () => void {
  let isClosing = false;
  const cleanup = () => {
    dependencies.off('SIGINT', shutdown);
    dependencies.off('SIGTERM', shutdown);
  };
  const shutdown = () => {
    if (isClosing) return;
    isClosing = true;
    cleanup();
    void application.close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected shutdown error';
      dependencies.writeStderr(`Agent Profile shutdown failed: ${message}\n`);
      dependencies.setExitCode(1);
    });
  };

  dependencies.once('SIGINT', shutdown);
  dependencies.once('SIGTERM', shutdown);
  return cleanup;
}

export async function startLocalApplication(
  options: LocalApplicationOptions,
  dependencies: LocalApplicationDependencies,
): Promise<LocalApplicationHandle> {
  const webServer = await dependencies.startWebServer({ port: options.webPort });
  const runtime = dependencies.createRuntime({
    databasePath: options.databasePath,
    autoScanDir: options.defaultScanDir,
    defaultScanDir: options.defaultScanDir,
  });
  let httpServer: HttpServerHandle | undefined;

  try {
    httpServer = await dependencies.startHttpServer({
      runtime,
      host: options.host,
      port: options.port,
      webUpstream: webServer.url,
    });
    await runtime.imports.startStartupImports();
    const url = `http://${options.host}:${options.port}`;
    if (options.openBrowser) await dependencies.openBrowser(url);

    let isClosed = false;
    return {
      report: {
        url,
        apiUrl: `${url}/api`,
        databasePath: options.databasePath,
        host: options.host,
        port: options.port,
      },
      close: async () => {
        if (isClosed) return;
        isClosed = true;
        await httpServer?.close();
        await runtime.close();
        await webServer.close();
      },
    };
  } catch (error) {
    await httpServer?.close();
    await runtime.close();
    await webServer.close();
    throw error;
  }
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerProviderRoutes } from '../routes/provider';
import { createRuntime } from '../runtime';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Provider configuration routes', () => {
  it('reports not_configured status without a key and never echoes the key', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });
    const app = Fastify({ logger: false });
    registerProviderRoutes(app, runtime);

    const response = await app.inject({ method: 'GET', url: '/api/provider/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false,
      provider: null,
      keyConfigured: false,
      configSource: 'none',
    });
    expect(response.body).not.toContain('secret');
    await app.close();
    await runtime.close();
  });

  it('stores a provider configuration in a server-only file and exposes non-secret status', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'agent-profile-provider-'));
    tempDirectories.push(dataDirectory);
    process.env.AGENT_PROFILE_DATA_DIR = dataDirectory;
    try {
      const runtime = createRuntime({
        database: createDatabase(':memory:'),
        autoScanDir: null,
        defaultScanDir: '~/.claude/projects',
        clock: () => 1000,
      });
      const app = Fastify({ logger: false });
      registerProviderRoutes(app, runtime);

      const put = await app.inject({
        method: 'PUT',
        url: '/api/provider/configuration',
        payload: {
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'route-model',
          apiKey: 'sk-super-secret-key-value',
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().status).toMatchObject({
        configured: true,
        provider: 'openai',
        endpointHost: 'api.example.com',
        endpointLocality: 'external',
        keyConfigured: true,
      });
      expect(put.body).not.toContain('sk-super-secret-key-value');

      const status = await app.inject({ method: 'GET', url: '/api/provider/status' });
      expect(status.json()).toMatchObject({ configured: true, configSource: 'file' });
      expect(status.body).not.toContain('sk-super-secret-key-value');
      await app.close();
      await runtime.close();
    } finally {
      delete process.env.AGENT_PROFILE_DATA_DIR;
    }
  });
});

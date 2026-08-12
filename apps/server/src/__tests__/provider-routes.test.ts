import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { loadProviderConfiguration, providerStatus } from '../provider-config';
import { registerProviderRoutes } from '../routes/provider';
import { createRuntime } from '../runtime';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  delete process.env.AGENT_PROFILE_DATA_DIR;
});

describe('Provider configuration routes', () => {
  it('labels the legacy environment fallback as env-sourced', () => {
    const configuration = loadProviderConfiguration({
      dataDirectory: '/path/that/does/not/exist',
      env: {
        LLM_API_KEY: 'env-secret',
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'env-model',
        LLM_BASE_URL: 'http://127.0.0.1:4100/v1',
      },
    });

    expect(configuration).toMatchObject({ source: 'env', model: 'env-model' });
    expect(providerStatus(configuration)).toMatchObject({
      configured: true,
      configSource: 'env',
      keyConfigured: true,
      endpointUrl: 'http://127.0.0.1:4100/v1',
    });
  });

  it('preserves only the safe path of a configured endpoint', () => {
    const status = providerStatus({
      provider: 'openai',
      baseUrl: 'https://user:password@provider.example/v1?token=url-secret#fragment',
      model: 'fixture-model',
      apiKey: 'api-secret',
    });

    expect(status).toMatchObject({
      endpointHost: 'provider.example',
      endpointUrl: 'https://provider.example/v1',
    });
    expect(JSON.stringify(status)).not.toContain('password');
    expect(JSON.stringify(status)).not.toContain('url-secret');
  });

  it('reports not_configured status without a key and never echoes the key', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'agent-profile-provider-empty-'));
    tempDirectories.push(dataDirectory);
    process.env.AGENT_PROFILE_DATA_DIR = dataDirectory;
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
      providerFetch: async () => new Response('{}', { status: 200 }),
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
    delete process.env.AGENT_PROFILE_DATA_DIR;
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
        providerFetch: async () => new Response('{}', { status: 200 }),
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
        endpointUrl: 'https://api.example.com/v1',
        endpointLocality: 'external',
        keyConfigured: true,
        testStatus: 'passed',
      });
      expect(put.json().test).toEqual({ status: 'passed' });
      expect(put.body).not.toContain('sk-super-secret-key-value');

      const status = await app.inject({ method: 'GET', url: '/api/provider/status' });
      expect(status.json()).toMatchObject({ configured: true, configSource: 'file' });
      expect(status.body).not.toContain('sk-super-secret-key-value');
      const retest = await app.inject({ method: 'POST', url: '/api/provider/test' });
      expect(retest.statusCode).toBe(200);
      expect(retest.json()).toMatchObject({ ok: true, test: { status: 'passed' } });
      await app.close();
      await runtime.close();
    } finally {
      delete process.env.AGENT_PROFILE_DATA_DIR;
    }
  });
});

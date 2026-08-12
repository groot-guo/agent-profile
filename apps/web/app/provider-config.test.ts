import { describe, expect, it, vi } from 'vitest';
import {
  defaultProviderConfiguration,
  endpointLocalityLabel,
  loadProviderStatus,
  providerLabel,
  providerTestLabel,
  saveProviderConfiguration,
  testProvider,
} from './provider-config';

describe('Provider configuration helpers', () => {
  it('provides explicit defaults for both supported Provider protocols', () => {
    expect(defaultProviderConfiguration('openai')).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
    expect(defaultProviderConfiguration('anthropic')).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5',
    });
  });

  it('labels non-secret status values for the settings page', () => {
    expect(providerLabel('openai')).toBe('OpenAI-compatible');
    expect(providerLabel(null)).toBe('未配置');
    expect(endpointLocalityLabel('loopback')).toBe('本机地址');
    expect(endpointLocalityLabel('external')).toBe('外部地址');
    expect(providerTestLabel({ status: 'passed' })).toContain('通过');
    expect(providerTestLabel({ status: 'failed', reason: 'timeout' })).toContain('超时');
    expect(
      providerTestLabel({ status: 'failed', reason: 'model_unavailable', httpStatus: 400 }),
    ).toContain('模型 ID 不可用');
  });

  it('loads and saves status without exposing credentials in the helper', async () => {
    const status = {
      configured: true,
      provider: 'openai' as const,
      model: 'fixture-model',
      endpointHost: '127.0.0.1',
      endpointUrl: 'http://127.0.0.1:4100/v1',
      endpointLocality: 'loopback' as const,
      configSource: 'file' as const,
      testStatus: 'untested' as const,
      restartRequired: false,
      keyConfigured: true,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => status })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status, test: { status: 'passed' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status, test: { status: 'passed' } }),
      });

    await expect(loadProviderStatus('/api', request)).resolves.toEqual(status);
    await expect(
      saveProviderConfiguration(
        '/api',
        {
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'fixture-model',
          apiKey: 'secret-fixture-key',
        },
        request,
      ),
    ).resolves.toMatchObject({ status, test: { status: 'passed' } });
    await expect(testProvider('/api', request)).resolves.toMatchObject({
      status,
      test: { status: 'passed' },
    });
    expect(request).toHaveBeenCalledWith('/api/provider/status');
    expect(request).toHaveBeenCalledWith(
      '/api/provider/configuration',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(request).toHaveBeenCalledWith('/api/provider/test', { method: 'POST' });
  });
});

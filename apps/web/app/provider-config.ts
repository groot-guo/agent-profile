export type ProviderKind = 'anthropic' | 'openai';

export interface ProviderStatus {
  configured: boolean;
  provider: ProviderKind | null;
  model: string | null;
  endpointHost: string | null;
  endpointLocality: 'loopback' | 'external' | 'unknown';
  configSource: 'file' | 'env' | 'none';
  testStatus: 'untested' | 'passed' | 'failed';
  restartRequired: boolean;
  keyConfigured: boolean;
}

export interface ProviderConfigurationInput {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type JsonRequest = (url: string, init?: RequestInit) => Promise<JsonResponse>;

export async function loadProviderStatus(
  api: string,
  request: JsonRequest = fetch,
): Promise<ProviderStatus> {
  const response = await request(`${api}/provider/status`);
  if (!response.ok) throw new Error(`Provider status HTTP ${response.status}`);
  return (await response.json()) as ProviderStatus;
}

export async function saveProviderConfiguration(
  api: string,
  configuration: ProviderConfigurationInput,
  request: JsonRequest = fetch,
): Promise<ProviderStatus> {
  const response = await request(`${api}/provider/configuration`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration),
  });
  if (!response.ok) throw new Error(`Provider configuration HTTP ${response.status}`);
  const body = (await response.json()) as { status?: ProviderStatus };
  if (!body.status) throw new Error('Provider configuration response is incomplete');
  return body.status;
}

export function providerLabel(provider: ProviderKind | null): string {
  return provider === 'anthropic'
    ? 'Anthropic'
    : provider === 'openai'
      ? 'OpenAI-compatible'
      : '未配置';
}

export function endpointLocalityLabel(locality: ProviderStatus['endpointLocality']): string {
  if (locality === 'loopback') return '本机地址';
  if (locality === 'external') return '外部地址';
  return '地址未知';
}

export function defaultProviderConfiguration(
  provider: ProviderKind,
): Omit<ProviderConfigurationInput, 'apiKey'> {
  return provider === 'anthropic'
    ? {
        provider,
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-5',
      }
    : {
        provider,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      };
}

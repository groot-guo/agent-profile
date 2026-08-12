export type ProviderKind = 'anthropic' | 'openai';

export interface ProviderStatus {
  configured: boolean;
  provider: ProviderKind | null;
  model: string | null;
  endpointHost: string | null;
  endpointUrl: string | null;
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

export interface ProviderTestResult {
  status: 'passed' | 'failed';
  reason?:
    | 'not_configured'
    | 'timeout'
    | 'network_error'
    | 'authentication_error'
    | 'model_unavailable'
    | 'invalid_request'
    | 'endpoint_not_found'
    | 'http_error';
  httpStatus?: number;
}

export interface ProviderOperationResult {
  status: ProviderStatus;
  test: ProviderTestResult;
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
): Promise<ProviderOperationResult> {
  const response = await request(`${api}/provider/configuration`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration),
  });
  if (!response.ok) throw new Error(`Provider configuration HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: ProviderStatus;
    test?: ProviderTestResult;
  };
  if (!body.status || !body.test) throw new Error('Provider configuration response is incomplete');
  return { status: body.status, test: body.test };
}

export async function testProvider(
  api: string,
  request: JsonRequest = fetch,
): Promise<ProviderOperationResult> {
  const response = await request(`${api}/provider/test`, { method: 'POST' });
  if (!response.ok) throw new Error(`Provider test HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: ProviderStatus;
    test?: ProviderTestResult;
  };
  if (!body.status || !body.test) throw new Error('Provider test response is incomplete');
  return { status: body.status, test: body.test };
}

export function providerTestLabel(test: ProviderTestResult): string {
  if (test.status === 'passed') return '连接测试通过（已消耗最小 probe token）';
  if (test.reason === 'authentication_error') {
    return `连接失败：API key 无效或无权访问该 Provider（HTTP ${test.httpStatus ?? '错误'}）`;
  }
  if (test.reason === 'model_unavailable') {
    return `连接失败：模型 ID 不可用（HTTP ${test.httpStatus ?? '错误'}）。请从该 API key 支持的模型列表选择模型。`;
  }
  if (test.reason === 'invalid_request') {
    return `连接失败：Provider 拒绝了请求（HTTP ${test.httpStatus ?? '错误'}），请检查协议、Base URL 和模型 ID。`;
  }
  if (test.reason === 'endpoint_not_found') {
    return `连接失败：Provider endpoint 不存在（HTTP ${test.httpStatus ?? '错误'}），请确认 Base URL 不要重复包含请求路径。`;
  }
  if (test.reason === 'http_error') return `连接失败：Provider HTTP ${test.httpStatus ?? '错误'}`;
  if (test.reason === 'timeout') return '连接失败：请求超时';
  if (test.reason === 'network_error') return '连接失败：网络或 TLS 错误';
  return '连接失败：尚未配置 Provider';
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

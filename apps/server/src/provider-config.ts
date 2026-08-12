import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultApplicationDataDirectory } from './data-path';

export type SemanticProviderKind = 'anthropic' | 'openai';
export type ProviderTestStatus = 'untested' | 'passed' | 'failed';
export type ProviderConfigSource = 'file' | 'env' | 'none';

export interface ProviderStatus {
  configured: boolean;
  provider: SemanticProviderKind | null;
  model: string | null;
  endpointHost: string | null;
  endpointLocality: 'loopback' | 'external' | 'unknown';
  configSource: ProviderConfigSource;
  testStatus: ProviderTestStatus;
  restartRequired: boolean;
  keyConfigured: boolean;
}

export interface ProviderConfiguration {
  provider: SemanticProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  source?: Exclude<ProviderConfigSource, 'none'>;
}

const PROVIDER_FILE_NAME = 'provider.json';
const DEFAULT_MODEL: Record<SemanticProviderKind, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'deepseek-chat',
};

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function endpointHostOf(baseUrl: string): {
  host: string;
  locality: ProviderStatus['endpointLocality'];
} {
  try {
    const parsed = new URL(baseUrl);
    return {
      host: parsed.hostname,
      locality: isLoopbackHost(parsed.hostname) ? 'loopback' : 'external',
    };
  } catch {
    return { host: baseUrl, locality: 'unknown' };
  }
}

export function providerConfigFilePath(options: { dataDirectory?: string } = {}): string {
  const directory =
    options.dataDirectory ??
    process.env.AGENT_PROFILE_DATA_DIR?.trim() ??
    defaultApplicationDataDirectory();
  return join(directory, PROVIDER_FILE_NAME);
}

export function loadProviderConfiguration(
  options: { dataDirectory?: string; env?: NodeJS.ProcessEnv } = {},
): ProviderConfiguration | null {
  const env = options.env ?? process.env;
  const filePath = providerConfigFilePath(options);
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ProviderConfiguration>;
      if (
        (parsed.provider === 'anthropic' || parsed.provider === 'openai') &&
        typeof parsed.baseUrl === 'string' &&
        parsed.baseUrl.trim() &&
        typeof parsed.model === 'string' &&
        parsed.model.trim() &&
        typeof parsed.apiKey === 'string' &&
        parsed.apiKey.trim()
      ) {
        return {
          provider: parsed.provider,
          baseUrl: parsed.baseUrl.trim(),
          model: parsed.model.trim(),
          apiKey: parsed.apiKey.trim(),
          source: 'file',
        };
      }
    } catch {
      // 损坏的配置文件按未配置处理，不向 API 泄露内容。
    }
  }
  const envKey = env.LLM_API_KEY?.trim();
  if (envKey) {
    const provider: SemanticProviderKind =
      env.LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
    return {
      provider,
      baseUrl: (env.LLM_BASE_URL || 'https://api.openai.com/v1').trim(),
      model: (env.LLM_MODEL || DEFAULT_MODEL[provider]).trim(),
      apiKey: envKey,
      source: 'env',
    };
  }
  return null;
}

export function saveProviderConfiguration(
  configuration: ProviderConfiguration,
  options: { dataDirectory?: string } = {},
): void {
  const filePath = providerConfigFilePath(options);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(configuration, null, 2), { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function providerStatus(
  configuration: ProviderConfiguration | null,
  options: { testStatus?: ProviderTestStatus; restartRequired?: boolean } = {},
): ProviderStatus {
  if (!configuration) {
    return {
      configured: false,
      provider: null,
      model: null,
      endpointHost: null,
      endpointLocality: 'unknown',
      configSource: 'none',
      testStatus: 'untested',
      restartRequired: false,
      keyConfigured: false,
    };
  }
  const { host, locality } = endpointHostOf(configuration.baseUrl);
  return {
    configured: true,
    provider: configuration.provider,
    model: configuration.model,
    endpointHost: host,
    endpointLocality: locality,
    configSource: configuration.source ?? 'file',
    testStatus: options.testStatus ?? 'untested',
    restartRequired: options.restartRequired ?? false,
    keyConfigured: true,
  };
}

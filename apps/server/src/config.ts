export interface ServerConfig {
  port: number;
  host: string;
  webOrigins: string[];
  autoScanDir: string | null;
  defaultScanDir: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SCAN_DIR = '~/.claude/projects';
const DEFAULT_WEB_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsedPort = Number(env.PORT);
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65_535
      ? parsedPort
      : DEFAULT_PORT;
  const webOrigins = env.WEB_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port,
    host: env.HOST?.trim() || DEFAULT_HOST,
    webOrigins: webOrigins?.length ? webOrigins : [...DEFAULT_WEB_ORIGINS],
    // AUTO_SCAN_DIR 未设置 → 默认扫描所有源
    // AUTO_SCAN_DIR 设为空字符串 → 不自动扫描
    // AUTO_SCAN_DIR 设为路径 → 扫描该路径
    autoScanDir: env.AUTO_SCAN_DIR !== undefined ? env.AUTO_SCAN_DIR || null : DEFAULT_SCAN_DIR,
    defaultScanDir: DEFAULT_SCAN_DIR,
  };
}

export const config = loadConfig();

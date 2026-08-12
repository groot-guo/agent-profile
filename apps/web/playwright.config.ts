import { defineConfig } from '@playwright/test';

const PORT = 4310;
const WEB_PORT = 4311;
const cliEntry = '../../packages/cli/dist/agent-profile.mjs';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `node ${cliEntry} serve --host 127.0.0.1 --port ${PORT} --web-port ${WEB_PORT} --data-dir ../../.tmp/e2e-smoke`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AUTO_SCAN_DIR: '',
    },
  },
});

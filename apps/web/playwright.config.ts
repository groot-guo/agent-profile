import { defineConfig } from '@playwright/test';

const PORT = 4310;
const WEB_PORT = 4311;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `AGENT_PROFILE_WEB_STANDALONE=1 ./node_modules/.bin/next build && node ../../packages/cli/dist/agent-profile.mjs serve --host 127.0.0.1 --port ${PORT} --web-port ${WEB_PORT} --data-dir ../../.tmp/e2e-smoke`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AUTO_SCAN_DIR: '',
    },
  },
});

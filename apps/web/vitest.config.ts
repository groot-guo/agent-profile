import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.next-dev/**'],
  },
});

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentDistDir, developmentTsconfigPath } from './scripts/dev-paths.mjs';

const webRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(webRoot, '../..');
const isDevelopment = process.env.NODE_ENV === 'development';
const developmentCacheDir = isDevelopment
  ? developmentDistDir(3001, process.env.NEXT_DEV_DIST_DIR)
  : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // next dev and next build must not write into the same output tree.
  // Sharing .next can leave webpack-runtime.js pointing at chunks a build removed.
  distDir: developmentCacheDir ?? '.next',
  typescript: {
    tsconfigPath:
      developmentCacheDir && process.env.NEXT_DEV_DIST_DIR
        ? developmentTsconfigPath(developmentCacheDir)
        : 'tsconfig.json',
  },
  output: process.env.AGENT_PROFILE_WEB_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    webpackMemoryOptimizations: true,
  },
  transpilePackages: ['@agent-profile/core'],
  async rewrites() {
    const apiOrigin = process.env.AGENT_PROFILE_API_ORIGIN || 'http://127.0.0.1:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

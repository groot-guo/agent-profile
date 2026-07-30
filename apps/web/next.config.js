import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // next dev and next build must not write into the same output tree.
  // Sharing .next can leave webpack-runtime.js pointing at chunks a build removed.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  output: process.env.AGENT_PROFILE_WEB_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: workspaceRoot,
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

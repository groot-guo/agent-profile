/** @type {import('next').NextConfig} */
const nextConfig = {
  // next dev and next build must not write into the same output tree.
  // Sharing .next can leave webpack-runtime.js pointing at chunks a build removed.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  transpilePackages: ['@agent-profile/core'],
};

export default nextConfig;

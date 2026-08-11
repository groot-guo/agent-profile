const DEFAULT_PORT = 3001;
const GENERATED_CACHE_PATTERN = /^\.next-dev(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

export function parseDevInvocation(args, fallbackPort = DEFAULT_PORT) {
  let port = parsePort(fallbackPort);
  const nextArgs = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') continue;
    if (
      argument === '--hostname' ||
      argument.startsWith('--hostname=') ||
      argument.startsWith('-H')
    ) {
      throw new Error('Development hostname is fixed to 127.0.0.1');
    }
    if (argument === '--port' || argument === '-p') {
      port = parsePort(args[++index]);
      continue;
    }
    if (argument.startsWith('--port=')) {
      port = parsePort(argument.slice('--port='.length));
      continue;
    }
    if (argument.startsWith('-p=')) {
      port = parsePort(argument.slice('-p='.length));
      continue;
    }
    nextArgs.push(argument);
  }

  return { port, nextArgs };
}

export function developmentDistDir(port, configuredDistDir) {
  const distDir = configuredDistDir?.trim() || `.next-dev-${parsePort(port)}`;
  if (!GENERATED_CACHE_PATTERN.test(distDir)) {
    throw new Error('NEXT_DEV_DIST_DIR must name a local .next-dev generated-cache directory');
  }
  return distDir;
}

export function developmentCacheLockName(distDir) {
  return `${distDir}.agent-profile.lock`;
}

export function developmentTsconfigPath(distDir) {
  if (!GENERATED_CACHE_PATTERN.test(distDir)) {
    throw new Error('Development TypeScript configuration must use a local .next-dev cache name');
  }
  return `${distDir}.tsconfig.json`;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid development port: ${String(value)}`);
  }
  return port;
}

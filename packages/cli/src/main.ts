import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cwd } from 'node:process';
import { DEFAULT_SCAN_DIR } from 'trace-server/config';
import { createProductionRuntime, defaultDatabasePath } from 'trace-server/runtime';
import type { CliDependencies } from './runner';

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { version: string };

export const CLI_VERSION = packageMetadata.version;

export function createDefaultCliDependencies(): CliDependencies {
  return {
    cwd: cwd(),
    defaultDatabasePath,
    defaultScanDir: DEFAULT_SCAN_DIR,
    env: process.env,
    fileExists: existsSync,
    version: CLI_VERSION,
    createRuntime: createProductionRuntime,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}

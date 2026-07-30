import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, win32 } from 'node:path';

const APPLICATION_DIRECTORY = 'agent-profile';
const DATABASE_FILE_NAME = 'trace.db';

export interface ApplicationDataPathOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  env?: NodeJS.ProcessEnv;
}

export function defaultApplicationDataDirectory(options: ApplicationDataPathOptions = {}): string {
  const currentPlatform = options.platform ?? platform();
  const homeDirectory = options.homeDirectory ?? homedir();
  const env = options.env ?? process.env;

  if (currentPlatform === 'win32') {
    const baseDirectory = env.LOCALAPPDATA?.trim() || win32.join(homeDirectory, 'AppData', 'Local');
    return win32.join(baseDirectory, APPLICATION_DIRECTORY);
  }
  if (currentPlatform === 'darwin') {
    return join(homeDirectory, 'Library', 'Application Support', APPLICATION_DIRECTORY);
  }

  const baseDirectory = env.XDG_DATA_HOME?.trim() || join(homeDirectory, '.local', 'share');
  return join(baseDirectory, APPLICATION_DIRECTORY);
}

export function defaultDatabasePathFor(options: ApplicationDataPathOptions = {}): string {
  const currentPlatform = options.platform ?? platform();
  const dataDirectory = defaultApplicationDataDirectory(options);
  return currentPlatform === 'win32'
    ? win32.join(dataDirectory, DATABASE_FILE_NAME)
    : join(dataDirectory, DATABASE_FILE_NAME);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) return;
  mkdirSync(dirname(databasePath), { recursive: true });
}

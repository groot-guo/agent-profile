import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..');
const cliRoot = join(workspaceRoot, 'packages/cli');
const webStandalone = join(workspaceRoot, 'apps/web/.next/standalone');
const webStatic = join(workspaceRoot, 'apps/web/.next/static');
const cliBundle = join(cliRoot, 'dist/agent-profile.mjs');
const cliBundleMap = `${cliBundle}.map`;
const cliPackage = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const releaseName = `agent-profile-${cliPackage.version}-${process.platform}-${process.arch}`;
const releasesDirectory = join(workspaceRoot, 'dist/releases');
const releaseDirectory = join(releasesDirectory, releaseName);

for (const requiredPath of [cliBundle, webStandalone, webStatic]) {
  if (!existsSync(requiredPath))
    throw new Error(`Required release input is missing: ${requiredPath}`);
}

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(join(releaseDirectory, 'bin'), { recursive: true });
mkdirSync(join(releaseDirectory, 'node_modules'), { recursive: true });
cpSync(cliBundle, join(releaseDirectory, 'bin/agent-profile.mjs'));
if (existsSync(cliBundleMap))
  cpSync(cliBundleMap, join(releaseDirectory, 'bin/agent-profile.mjs.map'));
cpSync(webStandalone, join(releaseDirectory, 'web'), { recursive: true });
cpSync(webStatic, join(releaseDirectory, 'web/apps/web/.next/static'), { recursive: true });
const webPublic = join(workspaceRoot, 'apps/web/public');
if (existsSync(webPublic)) {
  cpSync(webPublic, join(releaseDirectory, 'web/apps/web/public'), { recursive: true });
}

const requireFromCli = createRequire(join(cliRoot, 'package.json'));
const betterSqlitePackage = requireFromCli.resolve('better-sqlite3/package.json');
const requireFromBetterSqlite = createRequire(betterSqlitePackage);
const bindingsPackage = requireFromBetterSqlite.resolve('bindings/package.json');
const requireFromBindings = createRequire(bindingsPackage);
const fileUriPackage = requireFromBindings.resolve('file-uri-to-path/package.json');
for (const packageJsonPath of [betterSqlitePackage, bindingsPackage, fileUriPackage]) {
  const packageDirectory = dirname(realpathSync(packageJsonPath));
  const packageName = JSON.parse(readFileSync(packageJsonPath, 'utf8')).name;
  cpSync(packageDirectory, join(releaseDirectory, 'node_modules', packageName), {
    recursive: true,
    dereference: true,
  });
}

writeFileSync(
  join(releaseDirectory, 'package.json'),
  `${JSON.stringify(
    {
      name: 'agent-profile',
      version: cliPackage.version,
      private: true,
      type: 'module',
      bin: { 'agent-profile': './bin/agent-profile.mjs' },
      engines: { node: '>=22' },
    },
    null,
    2,
  )}\n`,
);
for (const document of ['README.md', 'README.zh-CN.md']) {
  cpSync(join(workspaceRoot, document), join(releaseDirectory, document));
}

const archivePath = join(releasesDirectory, `${releaseName}.tar.gz`);
rmSync(archivePath, { force: true });
const archive = spawnSync(
  'tar',
  ['-czf', archivePath, '-C', releasesDirectory, basename(releaseDirectory)],
  {
    encoding: 'utf8',
  },
);
if (archive.status !== 0) {
  throw new Error(archive.stderr || 'Failed to create release archive');
}

process.stdout.write(`${releaseDirectory}\n${archivePath}\n`);

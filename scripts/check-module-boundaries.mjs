#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_REPO_ROOT;
const SERVER_SRC = join(REPO_ROOT, 'apps/server/src');
const WEB_SRC = join(REPO_ROOT, 'apps/web');
const CLI_SRC = join(REPO_ROOT, 'packages/cli/src');
const CONTRACTS_SRC = join(REPO_ROOT, 'packages/contracts/src');
const violations = [];

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === '.next' || entry === '.next-dev' || entry === 'node_modules') return;
      walk(fullPath, visit);
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.d.ts')
    ) {
      visit(relative(REPO_ROOT, fullPath), readFileSync(fullPath, 'utf8'));
    }
  }
}

function checkContracts(filePath, content) {
  const forbidden = [
    { pattern: /from ['"]fastify['"]/, label: 'Fastify' },
    { pattern: /from ['"]react['"]/, label: 'React' },
    { pattern: /from ['"]better-sqlite3['"]/, label: 'better-sqlite3' },
    { pattern: /from ['"]node:fs(?:\/[^'"]*)?['"]/, label: 'node:fs' },
    { pattern: /from ['"][^'"]*apps\/(?:server|web)/, label: 'application code' },
  ];
  for (const { pattern, label } of forbidden) {
    if (pattern.test(content)) violations.push(`${filePath}: contracts must not import ${label}`);
  }
}

function checkServer(filePath, content) {
  const routeSegment = `apps${sep}server${sep}src${sep}routes${sep}`;
  if (!filePath.includes(routeSegment)) return;
  const isRuntimeExempt =
    filePath.endsWith('health.ts') ||
    filePath.endsWith('index.ts') ||
    filePath.endsWith('shared.ts');
  if (/from ['"]\.\.\/db['"]/.test(content)) {
    violations.push(`${filePath}: routes must not import the production database module`);
  }
  const databaseValueImport =
    /import\s+(?!type\b)(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]\.\.\/database['"]/;
  if (databaseValueImport.test(content)) {
    violations.push(`${filePath}: routes must receive database values through the Runtime`);
  }
  if (/\bdefaultDeps\b/.test(content)) {
    violations.push(`${filePath}: routes must not define production dependency fallbacks`);
  }
  if (!isRuntimeExempt && !content.includes('AppRuntime')) {
    violations.push(`${filePath}: route registrars must accept an explicit Runtime dependency`);
  }
}

function checkWeb(filePath, content) {
  const serverImport = /from ['"](?:\.\.?\/)+(?:server|trace-server)[^'"]*['"]/;
  if (serverImport.test(content)) {
    violations.push(`${filePath}: Web must not import server application code`);
  }
  const schemaValueImport =
    /import\s+(?!type\b)(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]@agent-profile\/contracts['"]/;
  if (schemaValueImport.test(content)) {
    violations.push(
      `${filePath}: Web must import only types from @agent-profile/contracts, not runtime schema values`,
    );
  }
}

function checkCli(filePath, content) {
  const serverImport = /from ['"](?:\.\.?\/)+apps\/server[^'"]*['"]/;
  if (serverImport.test(content)) {
    violations.push(`${filePath}: CLI must not import server application code directly`);
  }
}

walk(CONTRACTS_SRC, checkContracts);
walk(SERVER_SRC, checkServer);
walk(WEB_SRC, checkWeb);
walk(CLI_SRC, checkCli);

if (violations.length > 0) {
  process.stderr.write(
    `Module boundary check: FAILED\n${violations.map((item) => `  ${item}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write('Module boundary check: OK\n');

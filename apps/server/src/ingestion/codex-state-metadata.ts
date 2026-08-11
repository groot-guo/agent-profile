import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { CodexAgentMetadata } from '@agent-profile/core';
import Database from 'better-sqlite3';

export interface CodexStateThreadMetadata extends CodexAgentMetadata {
  threadId: string;
  rolloutPath?: string;
  title?: string;
  sourceParentSessionId?: string;
  sourceChildMetadata: Record<string, CodexAgentMetadata>;
  fingerprint: string;
}

export interface CodexStateMetadataIndex {
  metadataFor(filePath: string, sessionId?: string): CodexStateThreadMetadata | undefined;
}

interface StateThreadRow {
  id: string;
  rolloutPath: string | null;
  title: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  agentPath: string | null;
}

interface StateEdgeRow {
  parentThreadId: string;
  childThreadId: string;
}

const EMPTY_INDEX: CodexStateMetadataIndex = {
  metadataFor: () => undefined,
};

const MAX_SESSION_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_TITLE_LENGTH = 160;

export function resolveCodexStateDatabasePath(homeDirectory = homedir()): string | undefined {
  const codexDirectory = resolve(homeDirectory, '.codex');
  let candidates: string[];
  try {
    candidates = readdirSync(codexDirectory)
      .filter((entry) => /^state_\d+\.sqlite$/.test(entry))
      .sort((left, right) => {
        const leftVersion = Number(left.match(/\d+/)?.[0] ?? 0);
        const rightVersion = Number(right.match(/\d+/)?.[0] ?? 0);
        return rightVersion - leftVersion;
      });
  } catch {
    return undefined;
  }
  const candidate = candidates[0];
  if (!candidate) return undefined;
  const path = resolve(codexDirectory, candidate);
  try {
    statSync(path);
    return path;
  } catch {
    return undefined;
  }
}

export function loadCodexStateMetadataIndex(
  databasePath = resolveCodexStateDatabasePath(),
): CodexStateMetadataIndex {
  if (!databasePath) return EMPTY_INDEX;

  let database: InstanceType<typeof Database>;
  try {
    database = new Database(databasePath, { readonly: true });
  } catch {
    return EMPTY_INDEX;
  }

  try {
    const threadRows = readThreadRows(database);
    const edgeRows = readEdgeRows(database);
    return createIndex(threadRows, edgeRows, readSessionIndexTitles(databasePath));
  } catch {
    return EMPTY_INDEX;
  } finally {
    database.close();
  }
}

function readThreadRows(database: InstanceType<typeof Database>): StateThreadRow[] {
  const columns = columnsOf(database, 'threads');
  if (!columns.has('id')) return [];
  const select = (column: string, alias: string): string =>
    columns.has(column) ? `${column} AS ${alias}` : `NULL AS ${alias}`;
  return database
    .prepare(
      `SELECT ${select('id', 'id')},
              ${select('rollout_path', 'rolloutPath')},
              ${select('title', 'title')},
              ${select('agent_nickname', 'agentNickname')},
              ${select('agent_role', 'agentRole')},
              ${select('agent_path', 'agentPath')}
       FROM threads`,
    )
    .all() as StateThreadRow[];
}

function readEdgeRows(database: InstanceType<typeof Database>): StateEdgeRow[] {
  const columns = columnsOf(database, 'thread_spawn_edges');
  if (!columns.has('parent_thread_id') || !columns.has('child_thread_id')) return [];
  return database
    .prepare(
      `SELECT parent_thread_id as parentThreadId, child_thread_id as childThreadId
       FROM thread_spawn_edges`,
    )
    .all() as StateEdgeRow[];
}

function readSessionIndexTitles(databasePath: string): Map<string, string> {
  const indexPath = resolve(dirname(databasePath), 'session_index.jsonl');
  try {
    if (statSync(indexPath).size > MAX_SESSION_INDEX_BYTES) return new Map();
    const titles = new Map<string, string>();
    for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      const id = nonEmpty((value as { id?: unknown }).id);
      const title = boundedTitle((value as { thread_name?: unknown }).thread_name);
      if (id && title) titles.set(id, title);
    }
    return titles;
  } catch {
    return new Map();
  }
}

function columnsOf(database: InstanceType<typeof Database>, table: string): Set<string> {
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function createIndex(
  threadRows: StateThreadRow[],
  edgeRows: StateEdgeRow[],
  sessionIndexTitles = new Map<string, string>(),
): CodexStateMetadataIndex {
  const threadsById = new Map<string, StateThreadRow>();
  for (const row of [...threadRows].sort((left, right) => left.id.localeCompare(right.id))) {
    const threadId = nonEmpty(row.id);
    if (threadId) threadsById.set(threadId, row);
  }

  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();
  for (const edge of [...edgeRows].sort(
    (left, right) =>
      left.parentThreadId.localeCompare(right.parentThreadId) ||
      left.childThreadId.localeCompare(right.childThreadId),
  )) {
    const parentId = nonEmpty(edge.parentThreadId);
    const childId = nonEmpty(edge.childThreadId);
    if (!parentId || !childId || parentId === childId) continue;
    parentByChild.set(childId, parentId);
    const children = childrenByParent.get(parentId) ?? [];
    if (!children.includes(childId)) children.push(childId);
    childrenByParent.set(parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort();

  const byThreadId = new Map<string, CodexStateThreadMetadata>();
  const byRolloutPath = new Map<string, CodexStateThreadMetadata>();
  for (const [threadId, row] of threadsById) {
    const childMetadata: Record<string, CodexAgentMetadata> = {};
    for (const childId of childrenByParent.get(threadId) ?? []) {
      const child = threadsById.get(childId);
      childMetadata[childId] = {
        agentNickname: nonEmpty(child?.agentNickname),
        agentRole: nonEmpty(child?.agentRole),
        agentPath: nonEmpty(child?.agentPath),
      };
    }
    const title = sessionIndexTitles.get(threadId) ?? boundedTitle(row.title);
    const metadata = {
      threadId,
      rolloutPath: nonEmpty(row.rolloutPath),
      title,
      agentNickname: nonEmpty(row.agentNickname),
      agentRole: nonEmpty(row.agentRole),
      agentPath: nonEmpty(row.agentPath),
      sourceParentSessionId: parentByChild.get(threadId),
      sourceChildMetadata: childMetadata,
      fingerprint: metadataFingerprint({
        threadId,
        rolloutPath: nonEmpty(row.rolloutPath),
        title,
        agentNickname: nonEmpty(row.agentNickname),
        agentRole: nonEmpty(row.agentRole),
        agentPath: nonEmpty(row.agentPath),
        sourceParentSessionId: parentByChild.get(threadId),
        sourceChildMetadata: childMetadata,
      }),
    } satisfies CodexStateThreadMetadata;
    byThreadId.set(threadId, metadata);
    if (metadata.rolloutPath) byRolloutPath.set(normalizePath(metadata.rolloutPath), metadata);
  }

  return {
    metadataFor(filePath, sessionId) {
      return (
        byRolloutPath.get(normalizePath(filePath)) ??
        (sessionId ? byThreadId.get(sessionId) : undefined)
      );
    },
  };
}

function metadataFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function normalizePath(value: string): string {
  return resolve(value.replace(/^~(?=\/|$)/, homedir()));
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedTitle(value: unknown): string | undefined {
  const title = nonEmpty(typeof value === 'string' ? value : undefined);
  if (!title || title.startsWith('<codex_delegation')) return undefined;
  return title.length <= MAX_TITLE_LENGTH ? title : `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

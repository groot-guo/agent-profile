import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type MiMoMessage,
  type MiMoPart,
  type MiMoSessionMeta,
  parseMiMoSession,
} from '@agent-profile/core';
import Database from 'better-sqlite3';
import type { SourceAdapter, SourceItem } from './types';

interface MiMoSessionRow extends MiMoSessionMeta {
  message_count: number;
  part_count: number;
}

interface MessageRow {
  id: string;
  agent_id: string;
  data: string;
}

interface PartRow {
  id: string;
  message_id: string;
  data: string;
}

interface ExternalImportRow {
  session_id: string;
  source: string;
  source_path: string;
  source_mtime: number;
  time_imported: number;
}

const MIMO_REVISION_VERSION = 'mimo-v2';
const CLAUDE_PROJECTS_DIRECTORY = resolve(homedir(), '.claude', 'projects');

export class MiMoSourceAdapter implements SourceAdapter {
  readonly kind = 'mimo-code';

  constructor(private readonly databasePath = `${homedir()}/.local/share/mimocode/mimocode.db`) {}

  async discover(): Promise<SourceItem[]> {
    try {
      statSync(this.databasePath);
    } catch {
      return [];
    }

    const database = new Database(this.databasePath, { readonly: true });
    let sessions: MiMoSessionRow[];
    let externalImports: ExternalImportRow[] = [];
    try {
      sessions = database
        .prepare(
          `SELECT s.id, s.title, s.directory, s.time_created, s.time_updated,
            (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as message_count,
            (SELECT COUNT(*) FROM part p WHERE p.session_id = s.id) as part_count
           FROM session s
           ORDER BY s.time_created DESC`,
        )
        .all() as MiMoSessionRow[];
      const hasExternalImportTable = database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'external_import' LIMIT 1",
        )
        .get();
      if (hasExternalImportTable) {
        externalImports = database
          .prepare(
            `SELECT session_id, source, source_path, source_mtime, time_imported
             FROM external_import`,
          )
          .all() as ExternalImportRow[];
      }
    } finally {
      database.close();
    }

    const importsBySession = new Map<string, ExternalImportRow[]>();
    for (const externalImport of externalImports) {
      const imports = importsBySession.get(externalImport.session_id) ?? [];
      imports.push(externalImport);
      importsBySession.set(externalImport.session_id, imports);
    }

    return sessions.map((session) => {
      const imports = importsBySession.get(session.id) ?? [];
      const excluded = imports.some(isExternalClaudeCodeHistory);
      return {
        key: session.id,
        sessionId: session.id,
        revision: {
          kind: this.kind,
          updatedAt: session.time_updated,
          fingerprint: `${MIMO_REVISION_VERSION}:${session.time_updated}:${session.message_count}:${session.part_count}:${externalImportFingerprint(imports)}`,
        },
        load: async () =>
          excluded
            ? {
                excluded: true as const,
                sessionId: session.id,
                reason: 'non_actionable_external_history' as const,
              }
            : this.loadSession(session),
      };
    });
  }

  private async loadSession(session: MiMoSessionRow) {
    const database = new Database(this.databasePath, { readonly: true });
    let messageRows: MessageRow[];
    let partRows: PartRow[];
    try {
      messageRows = database
        .prepare(
          'SELECT id, agent_id, data FROM message WHERE session_id = ? ORDER BY time_created',
        )
        .all(session.id) as MessageRow[];
      partRows = database
        .prepare('SELECT id, message_id, data FROM part WHERE session_id = ?')
        .all(session.id) as PartRow[];
    } finally {
      database.close();
    }

    const partsByMessage = new Map<string, MiMoPart[]>();
    for (const row of partRows) {
      try {
        const parts = partsByMessage.get(row.message_id) ?? [];
        parts.push({
          id: row.id,
          data: JSON.parse(row.data) as MiMoPart['data'],
        });
        partsByMessage.set(row.message_id, parts);
      } catch {
        // A malformed part is omitted while the rest of the session remains importable.
      }
    }

    const messages: MiMoMessage[] = [];
    for (const row of messageRows) {
      try {
        messages.push({
          id: row.id,
          agent_id: row.agent_id,
          data: JSON.parse(row.data) as MiMoMessage['data'],
          parts: partsByMessage.get(row.id) ?? [],
        });
      } catch {
        // A malformed message is omitted while the rest of the session remains importable.
      }
    }

    const parsed = parseMiMoSession(session, messages);
    return parsed ? { parsed } : null;
  }
}

function isExternalClaudeCodeHistory(externalImport: ExternalImportRow): boolean {
  if (externalImport.source !== 'cc' || !isAbsolute(externalImport.source_path)) return false;
  const pathFromProjectsDirectory = relative(
    CLAUDE_PROJECTS_DIRECTORY,
    resolve(externalImport.source_path),
  );
  return (
    pathFromProjectsDirectory !== '' &&
    pathFromProjectsDirectory !== '..' &&
    !pathFromProjectsDirectory.startsWith('../')
  );
}

function externalImportFingerprint(externalImports: ExternalImportRow[]): string {
  if (externalImports.length === 0) return 'none';
  const source = externalImports
    .map(
      (externalImport) =>
        `${externalImport.source}\u0000${externalImport.source_path}\u0000${externalImport.source_mtime}\u0000${externalImport.time_imported}`,
    )
    .sort()
    .join('\u0001');
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

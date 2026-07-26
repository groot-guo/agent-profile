import { statSync } from 'node:fs';
import { homedir } from 'node:os';
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
    } finally {
      database.close();
    }

    return sessions.map((session) => ({
      key: session.id,
      sessionId: session.id,
      revision: {
        kind: this.kind,
        updatedAt: session.time_updated,
        fingerprint: `mimo:${session.time_updated}:${session.message_count}:${session.part_count}`,
      },
      load: async () => this.loadSession(session),
    }));
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

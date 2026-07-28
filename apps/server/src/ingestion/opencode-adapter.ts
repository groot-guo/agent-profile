import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  type OpenCodeMessage,
  type OpenCodePart,
  type OpenCodeSessionMeta,
  parseOpenCodeSession,
} from '@agent-profile/core';
import Database from 'better-sqlite3';
import type { SourceAdapter, SourceItem } from './types';

const OPENCODE_PARSER_REVISION = 'v1';

interface OpenCodeSessionRow extends OpenCodeSessionMeta {
  message_count: number;
  part_count: number;
}

interface MessageRow {
  id: string;
  data: string;
}

interface PartRow {
  id: string;
  message_id: string;
  data: string;
}

export class OpenCodeSourceAdapter implements SourceAdapter {
  readonly kind = 'opencode';

  constructor(private readonly databasePath = `${homedir()}/.local/share/opencode/opencode.db`) {}

  async discover(): Promise<SourceItem[]> {
    try {
      statSync(this.databasePath);
    } catch {
      return [];
    }

    const database = new Database(this.databasePath, { readonly: true });
    let sessions: OpenCodeSessionRow[];
    try {
      sessions = database
        .prepare(
          `SELECT s.id, s.title, s.directory, s.model, s.agent,
            s.tokens_input, s.tokens_output, s.tokens_reasoning,
            s.tokens_cache_read, s.tokens_cache_write, s.time_created, s.time_updated,
            (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as message_count,
            (SELECT COUNT(*) FROM part p WHERE p.session_id = s.id) as part_count
           FROM session s
           ORDER BY s.time_created DESC`,
        )
        .all() as OpenCodeSessionRow[];
    } finally {
      database.close();
    }

    return sessions.map((session) => ({
      key: session.id,
      sessionId: session.id,
      revision: {
        kind: this.kind,
        updatedAt: session.time_updated,
        fingerprint: `opencode-${OPENCODE_PARSER_REVISION}:${session.time_updated}:${session.message_count}:${session.part_count}`,
      },
      load: async () => this.loadSession(session),
    }));
  }

  private async loadSession(session: OpenCodeSessionRow) {
    const database = new Database(this.databasePath, { readonly: true });
    let messageRows: MessageRow[];
    let partRows: PartRow[];
    try {
      messageRows = database
        .prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id')
        .all(session.id) as MessageRow[];
      partRows = database
        .prepare(
          'SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id',
        )
        .all(session.id) as PartRow[];
    } finally {
      database.close();
    }

    const partsByMessage = new Map<string, OpenCodePart[]>();
    for (const row of partRows) {
      try {
        const parts = partsByMessage.get(row.message_id) ?? [];
        parts.push({ id: row.id, data: JSON.parse(row.data) as OpenCodePart['data'] });
        partsByMessage.set(row.message_id, parts);
      } catch {
        // Keep the Session importable when one source part is malformed.
      }
    }

    const messages: OpenCodeMessage[] = [];
    for (const row of messageRows) {
      try {
        messages.push({
          id: row.id,
          data: JSON.parse(row.data) as OpenCodeMessage['data'],
          parts: partsByMessage.get(row.id) ?? [],
        });
      } catch {
        // Keep the Session importable when one source message is malformed.
      }
    }

    const parsed = parseOpenCodeSession(session, messages);
    return parsed ? { parsed } : null;
  }
}

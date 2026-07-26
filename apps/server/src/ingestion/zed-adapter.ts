import { statSync } from 'node:fs';
import { parseZedThread, zedThreadsDbPath } from '@agent-profile/core';
import Database from 'better-sqlite3';
import type { SourceAdapter, SourceItem } from './types';

type Decompress = (input: Buffer) => Promise<Buffer>;

interface ZedRow {
  id: string;
  summary: string;
  folderPaths: string | null;
  updatedAt: string;
  createdAt: string | null;
  dataType: string;
  dataSize: number;
}

export interface ZedSourceAdapterOptions {
  databasePath?: string;
  decompress?: Decompress;
}

export class ZedSourceAdapter implements SourceAdapter {
  readonly kind = 'zed';
  private readonly databasePath: string;
  private readonly decompress?: Decompress;

  constructor(options: ZedSourceAdapterOptions = {}) {
    this.databasePath = options.databasePath ?? zedThreadsDbPath();
    this.decompress = options.decompress;
  }

  async discover(): Promise<SourceItem[]> {
    try {
      statSync(this.databasePath);
    } catch {
      return [];
    }

    const database = new Database(this.databasePath, { readonly: true });
    let rows: ZedRow[];
    try {
      rows = database
        .prepare(
          `SELECT id, summary, folder_paths as folderPaths, updated_at as updatedAt,
            created_at as createdAt, data_type as dataType, length(data) as dataSize
           FROM threads`,
        )
        .all() as ZedRow[];
    } finally {
      database.close();
    }

    return rows.map((row) => ({
      key: row.id,
      sessionId: row.id,
      revision: {
        kind: this.kind,
        updatedAt: toTimestamp(row.updatedAt),
        fingerprint: `zed:${row.updatedAt}:${row.dataType}:${row.dataSize}`,
      },
      load: async () => {
        const source = new Database(this.databasePath, { readonly: true });
        let payload: { dataType: string; data: Buffer } | undefined;
        try {
          payload = source
            .prepare('SELECT data_type as dataType, data FROM threads WHERE id = ?')
            .get(row.id) as { dataType: string; data: Buffer } | undefined;
        } finally {
          source.close();
        }
        if (!payload?.data?.length) return null;

        const decompress =
          this.decompress ??
          ((await import('simple-zstd')).decompressBuffer as (input: Buffer) => Promise<Buffer>);
        const dataBuffer = await decompress(payload.data);
        const parsed = await parseZedThread({
          id: row.id,
          summary: row.summary,
          folderPaths: row.folderPaths,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
          dataType: payload.dataType,
          dataBuffer,
        });
        return parsed ? { parsed } : null;
      },
    }));
  }
}

function toTimestamp(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

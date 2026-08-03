import type { ParsedSession } from '@agent-profile/core';

export interface SourceRevision {
  kind: string;
  updatedAt: number;
  fingerprint: string;
}

export interface LoadedSourceSession {
  parsed: ParsedSession;
  fileMeta?: {
    mtime: number;
    size: number;
    lines: number;
  };
  append?: {
    baseRevision: SourceRevision;
    closeSpanIds: string[];
    closeAt: number;
    fallback: () => Promise<LoadedSourceSession | ExcludedSourceSession | null>;
  };
}

export interface ExcludedSourceSession {
  excluded: true;
  sessionId: string;
  reason: 'non_actionable_external_history';
}

export type AppendedSourceSession = LoadedSourceSession & {
  append: NonNullable<LoadedSourceSession['append']>;
};

export type SourceLoadResult = LoadedSourceSession | ExcludedSourceSession | null;

export interface SourceItem {
  key: string;
  sessionId?: string;
  revision: SourceRevision;
  load: () => Promise<SourceLoadResult>;
}

export interface SourceAdapter {
  readonly kind: string;
  discover: () => Promise<SourceItem[]>;
}

export interface StoredSessionRevision {
  exists: boolean;
  kind?: string;
  updatedAt?: number;
  fingerprint?: string;
}

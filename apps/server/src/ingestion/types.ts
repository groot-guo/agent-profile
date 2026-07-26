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
}

export interface SourceItem {
  key: string;
  sessionId?: string;
  revision: SourceRevision;
  load: () => Promise<LoadedSourceSession | null>;
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

import type { ScanResult } from '@agent-profile/core';
import type { SessionRepository } from './session-repository';
import type { SourceAdapter } from './types';

export async function importFromSource(
  adapter: SourceAdapter,
  repository: SessionRepository,
): Promise<ScanResult> {
  const items = await adapter.discover();
  const result: ScanResult = {
    scanned: items.length,
    imported: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
    sessionIds: [],
  };

  for (const item of items) {
    try {
      if (item.sessionId && repository.isCurrent(item.sessionId, item.revision)) {
        result.skipped++;
        continue;
      }

      const loaded = await item.load();
      if (!loaded) {
        result.skipped++;
        continue;
      }

      const sessionId = loaded.parsed.sessionId;
      const stored = repository.getRevision(sessionId);
      if (
        stored.exists &&
        stored.kind === item.revision.kind &&
        stored.fingerprint === item.revision.fingerprint
      ) {
        result.skipped++;
        continue;
      }

      repository.replace(loaded, item.revision);
      if (stored.exists) result.updated++;
      else result.imported++;
      result.sessionIds.push(sessionId);
    } catch (error) {
      result.failed++;
      console.warn(
        `${adapter.kind} source ${item.key} failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  return result;
}

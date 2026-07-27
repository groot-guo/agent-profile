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
    removed: 0,
    failed: 0,
    sessionIds: [],
    skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
  };

  const skip = (reason: keyof ScanResult['skipReasons']) => {
    result.skipped++;
    result.skipReasons[reason]++;
  };

  for (const item of items) {
    try {
      if (item.sessionId && repository.isCurrent(item.sessionId, item.revision)) {
        skip('unchanged_revision');
        continue;
      }

      const loaded = await item.load();
      if (!loaded) {
        skip('not_importable');
        continue;
      }
      if ('excluded' in loaded) {
        const cleanup = repository.removeGeneratedIfUnannotated(loaded.sessionId);
        if (cleanup === 'annotated') {
          result.failed++;
          continue;
        }
        if (cleanup === 'removed') result.removed++;
        skip('excluded_non_actionable');
        continue;
      }

      const sessionId = loaded.parsed.sessionId;
      const stored = repository.getRevision(sessionId);
      if (
        stored.exists &&
        stored.kind === item.revision.kind &&
        stored.fingerprint === item.revision.fingerprint
      ) {
        skip('unchanged_revision');
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

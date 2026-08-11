import type { ScanResult } from '@agent-profile/core';
import { classifyProjectCwd } from '../project-scope';
import type { SessionRepository } from './session-repository';
import type { SourceAdapter } from './types';

export async function importFromSource(
  adapter: SourceAdapter,
  repository: SessionRepository,
  options: { force?: boolean; projectRoot?: string | null } = {},
): Promise<ScanResult> {
  const items = await adapter.discover();
  const result: ScanResult = {
    scanned: items.length,
    imported: 0,
    skipped: 0,
    updated: 0,
    removed: 0,
    failed: 0,
    protectedAnnotatedSessions: 0,
    projectCoverage: {
      projectRoot: options.projectRoot ?? null,
      discovered: items.length,
      included: 0,
      excluded: 0,
      unassigned: 0,
    },
    sessionIds: [],
    skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
  };

  const skip = (reason: keyof ScanResult['skipReasons']) => {
    result.skipped++;
    result.skipReasons[reason]++;
  };

  const recordProjectCoverage = (cwd: string | null | undefined): boolean => {
    const coverage = result.projectCoverage;
    if (!coverage) return true;
    const classification = classifyProjectCwd(cwd, options.projectRoot);
    coverage[classification]++;
    if (!options.projectRoot && classification === 'unassigned') {
      coverage.included++;
      return true;
    }
    if (classification === 'included') return true;
    skip('not_importable');
    return false;
  };

  for (const item of items) {
    try {
      if (!options.force && item.sessionId && repository.isCurrent(item.sessionId, item.revision)) {
        if (!recordProjectCoverage(repository.getSessionCwd(item.sessionId))) continue;
        skip('unchanged_revision');
        continue;
      }

      let loaded = await item.load();
      if (!loaded) {
        skip('not_importable');
        continue;
      }
      if ('excluded' in loaded) {
        const cleanup = repository.removeGeneratedIfUnannotated(
          loaded.sessionId,
          item.revision.kind,
        );
        if (cleanup === 'annotated') {
          result.failed++;
          result.protectedAnnotatedSessions++;
          continue;
        }
        if (cleanup === 'removed') result.removed++;
        skip('excluded_non_actionable');
        continue;
      }

      if (!recordProjectCoverage(loaded.parsed.meta.cwd)) {
        const previousCwd = repository.getSessionCwd(loaded.parsed.sessionId);
        if (
          options.projectRoot &&
          classifyProjectCwd(previousCwd, options.projectRoot) === 'included'
        ) {
          const cleanup = repository.removeGeneratedIfUnannotated(
            loaded.parsed.sessionId,
            item.revision.kind,
          );
          if (cleanup === 'removed') result.removed++;
          if (cleanup === 'annotated') {
            result.failed++;
            result.protectedAnnotatedSessions++;
          }
        }
        continue;
      }

      if (loaded.append) {
        const current = repository.getRevision(loaded.parsed.sessionId);
        if (
          !options.force &&
          current.exists &&
          current.kind === loaded.append.baseRevision.kind &&
          current.fingerprint === loaded.append.baseRevision.fingerprint
        ) {
          if (repository.append(loaded, item.revision)) {
            result.updated++;
            result.sessionIds.push(loaded.parsed.sessionId);
            continue;
          }
        }
        const fallback = await loaded.append.fallback();
        if (!fallback || 'excluded' in fallback || fallback.append) {
          skip('not_importable');
          continue;
        }
        loaded = fallback;
      }

      const sessionId = loaded.parsed.sessionId;
      const stored = repository.getRevision(sessionId);
      if (
        !options.force &&
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

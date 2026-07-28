import type { DataManagementSummary, ImportJobStatus, ImportSourceStatus } from './config';

export type ImportExperienceState =
  | 'loading'
  | 'empty-unavailable'
  | 'empty-ready'
  | 'empty-scanning'
  | 'partial-failure'
  | 'ready';

export function importExperienceState(
  loading: boolean,
  sessionCount: number,
  status: ImportJobStatus | null,
): ImportExperienceState {
  if (loading) return 'loading';
  if (!status) return sessionCount > 0 ? 'ready' : 'empty-unavailable';
  const failed = status.sources.some((source) => source.state === 'failed');
  if (sessionCount > 0) return failed ? 'partial-failure' : 'ready';
  if (status.active) return 'empty-scanning';
  if (failed) return 'partial-failure';
  return status.sources.some((source) => source.available) ? 'empty-ready' : 'empty-unavailable';
}

export function sourceStatusText(source: ImportSourceStatus): string {
  if (source.state === 'scanning') return '正在导入…';
  if (source.state === 'failed') return '导入失败，可重试';
  if (source.available) return `已发现 · ${source.storedSessions} 个会话`;
  return '本机未发现';
}

export function summarizeImport(status: ImportJobStatus): string {
  const completed = status.sources.filter((source) => source.result);
  const totals = completed.reduce(
    (sum, source) => ({
      scanned: sum.scanned + (source.result?.scanned ?? 0),
      imported: sum.imported + (source.result?.imported ?? 0),
      updated: sum.updated + (source.result?.updated ?? 0),
      skipped: sum.skipped + (source.result?.skipped ?? 0),
      removed: sum.removed + (source.result?.removed ?? 0),
      failed: sum.failed + (source.result?.failed ?? 0),
    }),
    { scanned: 0, imported: 0, updated: 0, skipped: 0, removed: 0, failed: 0 },
  );
  const sourceFailures = status.sources.filter((source) => source.state === 'failed').length;
  const failures = totals.failed + sourceFailures;
  return `已检查 ${totals.scanned} 条记录；新增 ${totals.imported}，更新 ${totals.updated}，跳过 ${totals.skipped}${totals.removed > 0 ? `，清理 ${totals.removed}` : ''}${failures > 0 ? `，失败 ${failures}` : ''}`;
}

export function canResetData(confirmation: string, summary: DataManagementSummary | null): boolean {
  return Boolean(summary && confirmation === summary.resetConfirmation);
}

export function summarizeReset(deleted: { sessions: number; spans: number }): string {
  return `已删除 ${deleted.sessions} 个会话、${deleted.spans} 个 Span；定价、模型窗口、任务验证和迁移记录已保留`;
}

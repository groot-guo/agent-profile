import { describe, expect, it } from 'vitest';
import type { ImportJobStatus, ImportSourceStatus } from './config';
import {
  canResetData,
  importExperienceState,
  sourceStatusText,
  summarizeImport,
  summarizeReset,
} from './import-state';

function source(overrides: Partial<ImportSourceStatus> = {}): ImportSourceStatus {
  return {
    id: 'claude-code',
    label: 'Claude Code',
    available: true,
    state: 'idle',
    result: null,
    startedAt: null,
    completedAt: null,
    error: null,
    storedSessions: 0,
    ...overrides,
  };
}

function status(sources: ImportSourceStatus[], active = false): ImportJobStatus {
  return { jobId: 'job-1', active, operation: active ? 'sync' : null, sources };
}

describe('import experience state', () => {
  it('distinguishes initial, unavailable, ready, scanning, partial failure, and success states', () => {
    expect(importExperienceState(true, 0, null)).toBe('loading');
    expect(importExperienceState(false, 0, status([source({ available: false })]))).toBe(
      'empty-unavailable',
    );
    expect(importExperienceState(false, 0, status([source()]))).toBe('empty-ready');
    expect(importExperienceState(false, 0, status([source({ state: 'scanning' })], true))).toBe(
      'empty-scanning',
    );
    expect(importExperienceState(false, 4, status([source({ state: 'failed' })]))).toBe(
      'partial-failure',
    );
    expect(importExperienceState(false, 4, status([source({ state: 'completed' })]))).toBe('ready');
  });

  it('provides recovery-oriented source labels and a bounded completion summary', () => {
    expect(sourceStatusText(source({ state: 'failed' }))).toBe('导入失败，可重试');
    expect(sourceStatusText(source({ storedSessions: 12 }))).toContain('12 个会话');
    expect(
      summarizeImport(
        status([
          source({
            state: 'completed',
            result: { scanned: 8, imported: 2, updated: 1, skipped: 5, removed: 3, failed: 0 },
          }),
          source({ id: 'codex', label: 'Codex', state: 'failed' }),
        ]),
      ),
    ).toBe('已检查 8 条记录；新增 2，更新 1，跳过 5，清理 3，失败 1');
  });

  it('requires the exact reset phrase and reports the retained configuration boundary', () => {
    const summary = {
      sessions: 4,
      spans: 12,
      annotatedSessions: 1,
      pricingRows: 2,
      modelContextRows: 3,
      migrations: 4,
      resetConfirmation: 'RESET LOCAL DATA',
    };
    expect(canResetData('RESET', summary)).toBe(false);
    expect(canResetData('RESET LOCAL DATA', summary)).toBe(true);
    expect(summarizeReset({ sessions: 4, spans: 12 })).toContain('定价、模型窗口和迁移记录已保留');
  });
});

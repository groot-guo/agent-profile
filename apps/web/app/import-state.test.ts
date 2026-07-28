import { describe, expect, it } from 'vitest';
import type { ImportJobStatus, ImportSourceStatus } from './config';
import {
  canResetData,
  importExperienceState,
  importProgressView,
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
            result: {
              scanned: 8,
              imported: 2,
              updated: 1,
              skipped: 5,
              removed: 3,
              failed: 0,
              protectedAnnotatedSessions: 0,
            },
          }),
          source({ id: 'codex', label: 'Codex', state: 'failed' }),
        ]),
      ),
    ).toBe('已检查 8 条记录；新增 2，更新 1，跳过 5，清理 3，失败 1');
    expect(
      sourceStatusText(
        source({
          state: 'completed',
          result: {
            scanned: 1,
            imported: 0,
            updated: 0,
            skipped: 1,
            removed: 0,
            failed: 1,
            protectedAnnotatedSessions: 1,
          },
        }),
      ),
    ).toContain('保留 1 个已标注会话（需手动处理）');
  });

  it('derives truthful source-level progress without counting unavailable sources', () => {
    const view = importProgressView(
      status(
        [
          source({
            id: 'claude-code',
            label: 'Claude Code',
            state: 'completed',
            result: {
              scanned: 8,
              imported: 2,
              updated: 1,
              skipped: 5,
              removed: 0,
              failed: 0,
              protectedAnnotatedSessions: 0,
            },
          }),
          source({ id: 'codex', label: 'Codex', state: 'scanning' }),
          source({ id: 'zed', label: 'Zed', available: false }),
          source({ id: 'mimo-code', label: 'MiMo Code', state: 'failed' }),
        ],
        true,
      ),
    );

    expect(view.availableSources).toHaveLength(3);
    expect(view.unavailableSources.map((item) => item.label)).toEqual(['Zed']);
    expect(view.activeSources.map((item) => item.label)).toEqual(['Codex']);
    expect(view.settledSources).toBe(2);
    expect(view.progressPercent).toBe(67);
    expect(view.statusText).toContain('正在处理 Codex');
  });

  it('requires the exact reset phrase and reports the retained configuration boundary', () => {
    const summary = {
      sessions: 4,
      spans: 12,
      annotatedSessions: 1,
      pricingRows: 2,
      modelContextRows: 3,
      migrations: 4,
      tasks: 2,
      outcomes: 1,
      configSnapshots: 2,
      cohorts: 1,
      experiments: 1,
      resetConfirmation: 'RESET LOCAL DATA',
    };
    expect(canResetData('RESET', summary)).toBe(false);
    expect(canResetData('RESET LOCAL DATA', summary)).toBe(true);
    expect(summarizeReset({ sessions: 4, spans: 12 })).toContain('任务验证和迁移记录已保留');
  });
});

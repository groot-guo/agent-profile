'use client';

import { useEffect, useRef } from 'react';
import type { DataManagementSummary } from './config';
import { canResetData } from './import-state';
import { CloseGlyph } from './session-list-ui';
import { SoftButton } from './ui';

export function DataManagementDialog({
  open,
  summary,
  scanning,
  resetting,
  confirmation,
  onConfirmationChange,
  onClose,
  onRebuild,
  onReset,
}: {
  open: boolean;
  summary: DataManagementSummary | null;
  scanning: boolean;
  resetting: boolean;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  onClose: () => void;
  onRebuild: () => void;
  onReset: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open || dialog.open) return;
    dialog.showModal();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="data-management-dialog"
      aria-labelledby="data-management-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="data-management-dialog-heading">
        <div>
          <span>Local data</span>
          <h2 id="data-management-title">数据管理</h2>
          <p>维护本地生成的分析数据；普通同步请使用侧栏的“同步数据”。</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭数据管理弹窗">
          <CloseGlyph />
        </button>
      </div>

      <section className="data-management-rebuild" aria-labelledby="data-rebuild-title">
        <div>
          <h3 id="data-rebuild-title">强制重建分析</h3>
          <p>
            重新解析所有可用来源，即使来源指纹未变化。标签、备注、定价和模型窗口配置会保留；不可用来源的已有数据不会被删除。
          </p>
        </div>
        <SoftButton variant="primary" onClick={onRebuild} disabled={scanning || resetting}>
          {scanning ? '任务进行中…' : '开始重建'}
        </SoftButton>
      </section>

      <section className="data-management-danger" aria-labelledby="data-reset-title">
        <div>
          <span>Danger zone</span>
          <h3 id="data-reset-title">永久清空生成数据</h3>
        </div>
        {summary ? (
          <p>
            将删除 {summary.sessions} 个会话和 {summary.spans} 个 Span
            {summary.annotatedSessions > 0
              ? `，其中 ${summary.annotatedSessions} 个带标签或备注`
              : ''}
            。定价、模型窗口、数据库迁移，以及 {summary.tasks} 个 Task、{summary.outcomes} 个
            Outcome、{summary.configSnapshots} 个配置快照、{summary.cohorts} 个 cohort 和{' '}
            {summary.experiments} 个 experiment 保留。操作前请停止 Server 并备份
            apps/server/trace.db（或 TRACE_DB_PATH 指定文件）。
          </p>
        ) : (
          <p>正在读取影响范围…</p>
        )}
        {summary && (
          <div className="data-management-confirmation">
            <label htmlFor="data-reset-confirmation">
              输入 <strong>{summary.resetConfirmation}</strong> 确认
            </label>
            <input
              id="data-reset-confirmation"
              aria-label="本地数据重置确认"
              placeholder={`输入 ${summary.resetConfirmation}`}
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
            />
            <SoftButton
              onClick={onReset}
              disabled={scanning || resetting || !canResetData(confirmation, summary)}
            >
              {resetting ? '正在清空…' : '永久清空生成数据'}
            </SoftButton>
          </div>
        )}
      </section>
    </dialog>
  );
}

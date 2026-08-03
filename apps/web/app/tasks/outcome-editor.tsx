'use client';

import type {
  OutcomeEvidenceStatus,
  TaskProfileOutcome,
  VerificationStatus,
} from '@agent-profile/core';
import { useState } from 'react';
import { C, FS } from '../theme';
import { SoftButton } from '../ui';
import {
  buildOutcomePayload,
  MAX_OUTCOME_EVIDENCE,
  type OutcomeDraft,
  type OutcomeDraftErrors,
} from './outcome-model';
import styles from './tasks.module.css';

const statusOptions: VerificationStatus[] = ['passed', 'failed', 'skipped', 'not_run'];
const evidenceStatusOptions: OutcomeEvidenceStatus[] = [
  'not_captured',
  'observed',
  'passed',
  'failed',
  'skipped',
  'not_run',
];
const statusFields = [
  ['buildStatus', 'Build'],
  ['testStatus', 'Test'],
  ['lintStatus', 'Lint'],
] as const;

export function OutcomeEditor({
  draft,
  coverage,
  saving,
  onChange,
  onSave,
}: {
  draft: OutcomeDraft;
  coverage: { status: string; observedFields: number; totalFields: number };
  saving: boolean;
  onChange: (draft: OutcomeDraft) => void;
  onSave: (payload: TaskProfileOutcome) => Promise<boolean>;
}) {
  const [errors, setErrors] = useState<OutcomeDraftErrors>({ evidence: {} });

  function update(next: OutcomeDraft) {
    onChange(next);
    setErrors({ evidence: {} });
  }

  async function submit() {
    const result = buildOutcomePayload(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    await onSave(result.value);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className={styles.statusGrid}>
        {statusFields.map(([field, label]) => (
          <label key={field} className={styles.fieldGroup}>
            <span className={styles.label}>{label}</span>
            <select
              className={styles.field}
              value={draft[field]}
              onChange={(event) => update({ ...draft, [field]: event.target.value })}
            >
              <option value="">未采集</option>
              {statusOptions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <label className={styles.fieldGroup}>
        <span className={styles.label}>Git commit</span>
        <input
          className={styles.field}
          value={draft.gitCommit}
          maxLength={201}
          aria-invalid={Boolean(errors.gitCommit)}
          onChange={(event) => update({ ...draft, gitCommit: event.target.value })}
          placeholder="例如 abc123"
        />
        {errors.gitCommit && <span className={styles.error}>{errors.gitCommit}</span>}
      </label>

      <div className={styles.statusGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.label}>人工评分</span>
          <select
            className={styles.field}
            value={draft.humanRating}
            onChange={(event) =>
              update({ ...draft, humanRating: event.target.value as OutcomeDraft['humanRating'] })
            }
          >
            <option value="">未采集</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value} / 5
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.fieldGroup} ${styles.completedField}`}>
          <span className={styles.label}>完成时间</span>
          <input
            className={styles.field}
            type="datetime-local"
            step="0.001"
            value={draft.completedAt}
            aria-invalid={Boolean(errors.completedAt)}
            onChange={(event) => update({ ...draft, completedAt: event.target.value })}
          />
          {errors.completedAt && <span className={styles.error}>{errors.completedAt}</span>}
        </label>
      </div>

      <label className={styles.fieldGroup}>
        <span className={styles.label}>返工原因</span>
        <textarea
          className={`${styles.field} ${styles.textarea}`}
          value={draft.reworkReason}
          maxLength={2001}
          aria-invalid={Boolean(errors.reworkReason)}
          onChange={(event) => update({ ...draft, reworkReason: event.target.value })}
          placeholder="可选；记录为什么需要返工"
        />
        {errors.reworkReason && <span className={styles.error}>{errors.reworkReason}</span>}
      </label>

      <div className={styles.evidenceSection}>
        <div className={styles.evidenceHeader}>
          <div>
            <div style={{ color: C.text, fontWeight: 600 }}>结构化证据</div>
            <div style={{ color: C.mute, fontSize: FS.cap }}>
              kind 必填；status 和本地 reference 可选
            </div>
          </div>
          <SoftButton
            disabled={draft.evidence.length >= MAX_OUTCOME_EVIDENCE}
            onClick={() =>
              update({
                ...draft,
                evidence: [
                  ...draft.evidence,
                  { id: crypto.randomUUID(), kind: '', status: '', reference: '' },
                ],
              })
            }
          >
            添加证据
          </SoftButton>
        </div>
        {errors.evidenceLimit && (
          <span className={styles.error} role="alert">
            {errors.evidenceLimit}
          </span>
        )}
        {draft.evidence.map((item, index) => (
          <div key={item.id} className={styles.evidenceRow}>
            <label className={styles.fieldGroup}>
              <span className={styles.label}>类型</span>
              <input
                className={styles.field}
                value={item.kind}
                maxLength={81}
                aria-invalid={Boolean(errors.evidence[index]?.kind)}
                onChange={(event) => {
                  const evidence = [...draft.evidence];
                  evidence[index] = { ...item, kind: event.target.value };
                  update({ ...draft, evidence });
                }}
                placeholder="例如 ci"
              />
              {errors.evidence[index]?.kind && (
                <span className={styles.error}>{errors.evidence[index]?.kind}</span>
              )}
            </label>
            <label className={styles.fieldGroup}>
              <span className={styles.label}>状态</span>
              <select
                className={styles.field}
                value={item.status}
                onChange={(event) => {
                  const evidence = [...draft.evidence];
                  evidence[index] = {
                    ...item,
                    status: event.target.value as OutcomeDraft['evidence'][number]['status'],
                  };
                  update({ ...draft, evidence });
                }}
              >
                <option value="">未采集</option>
                {evidenceStatusOptions.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldGroup}>
              <span className={styles.label}>引用</span>
              <input
                className={styles.field}
                value={item.reference}
                maxLength={501}
                aria-invalid={Boolean(errors.evidence[index]?.reference)}
                onChange={(event) => {
                  const evidence = [...draft.evidence];
                  evidence[index] = { ...item, reference: event.target.value };
                  update({ ...draft, evidence });
                }}
                placeholder="本地路径、run ID 或 URL"
              />
              {errors.evidence[index]?.reference && (
                <span className={styles.error}>{errors.evidence[index]?.reference}</span>
              )}
            </label>
            <button
              type="button"
              className={styles.removeButton}
              aria-label={`删除第 ${index + 1} 条证据`}
              title="删除证据"
              onClick={() =>
                update({
                  ...draft,
                  evidence: draft.evidence.filter((_, itemIndex) => itemIndex !== index),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
        {draft.evidence.length === 0 && (
          <div className={styles.emptyEvidence}>尚未记录结构化证据</div>
        )}
      </div>

      <SoftButton variant="primary" disabled={saving} onClick={submit} style={{ width: '100%' }}>
        {saving
          ? '保存中…'
          : `保存 Outcome · coverage ${coverage.observedFields}/${coverage.totalFields}`}
      </SoftButton>
    </div>
  );
}

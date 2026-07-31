'use client';

import type {
  ModelCatalogConfiguration,
  ModelCatalogContextRecord,
  ModelCatalogInventoryItem,
  ModelCatalogPricingRecord,
  ModelCatalogRecalculationPreview,
  ModelCatalogRecalculationResult,
} from '@agent-profile/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { API } from '../../config';
import { C } from '../../theme';
import { Chip, Notice } from '../../ui';
import {
  buildPricingPayload,
  catalogPriority,
  formatCatalogDate,
  isPreviewCurrent,
  type PricingDraft,
  sortCatalogModels,
  toLocalDateTime,
} from './model-catalog';
import styles from './model-catalog.module.css';

interface InventoryResponse {
  schemaVersion: 'model-catalog/v1';
  pricingRevision: string;
  models: ModelCatalogInventoryItem[];
}

interface HistoryResponse {
  model: string;
  schedules: ModelCatalogPricingRecord[];
}

type Feedback = { kind: 'ok' | 'err' | 'info'; text: string } | null;

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
  return body;
}

function priorityLabel(item: ModelCatalogInventoryItem): { text: string; color: string } {
  const priority = catalogPriority(item);
  if (priority === 'unsupported') return { text: '不支持定价', color: C.high };
  if (priority === 'unpriced') return { text: '未定价', color: C.medium };
  if (priority === 'context-missing') return { text: '缺上下文', color: C.cc };
  return { text: '已配置', color: C.cr };
}

function createPricingDraft(item: ModelCatalogInventoryItem): PricingDraft {
  const pricing = item.pricing;
  return {
    inputPrice: pricing ? String(pricing.inputPrice) : '',
    cacheCreationPrice: pricing ? String(pricing.cacheCreationPrice) : '',
    cacheReadPrice: pricing ? String(pricing.cacheReadPrice) : '',
    outputPrice: pricing ? String(pricing.outputPrice) : '',
    effectiveAt: toLocalDateTime(Date.now()),
    sourceReference: pricing?.sourceReference ?? '',
  };
}

export default function ModelCatalogPage() {
  return (
    <Suspense fallback={<div className={styles.page}>正在加载 Model Catalog…</div>}>
      <ModelCatalogWorkspace />
    </Suspense>
  );
}

function ModelCatalogWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedModel = searchParams.get('model');
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [history, setHistory] = useState<ModelCatalogPricingRecord[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const importInput = useRef<HTMLInputElement>(null);

  async function loadInventory(signal?: AbortSignal): Promise<InventoryResponse> {
    const response = await fetch(`${API}/model-catalog/models`, { signal });
    const next = await responseJson<InventoryResponse>(response);
    setInventory(next);
    return next;
  }

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    loadInventory(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFeedback({ kind: 'err', text: `模型目录加载失败：${String(error)}` });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const sortedModels = sortCatalogModels(inventory?.models ?? []);
  const filteredModels = sortedModels.filter((item) =>
    item.model.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected =
    sortedModels.find((item) => item.model === requestedModel) ?? sortedModels[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setHistory([]);
    fetch(`${API}/model-catalog/models/${encodeURIComponent(selected.model)}/pricing`, {
      signal: controller.signal,
    })
      .then((response) => responseJson<HistoryResponse>(response))
      .then((body) => setHistory(body.schedules))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFeedback({ kind: 'err', text: `价格历史加载失败：${String(error)}` });
        }
      });
    return () => controller.abort();
  }, [selected?.model]);

  function selectModel(model: string): void {
    router.replace(`/settings/models?model=${encodeURIComponent(model)}`);
    setFeedback(null);
  }

  async function reloadSelected(message?: string): Promise<void> {
    const next = await loadInventory();
    if (selected) {
      const response = await fetch(
        `${API}/model-catalog/models/${encodeURIComponent(selected.model)}/pricing`,
      );
      const body = await responseJson<HistoryResponse>(response);
      setHistory(body.schedules);
    }
    if (message) setFeedback({ kind: 'ok', text: message });
    setInventory(next);
  }

  async function exportConfiguration(): Promise<void> {
    try {
      const response = await fetch(`${API}/model-catalog/configuration`);
      const configuration = await responseJson<ModelCatalogConfiguration>(response);
      const blob = new Blob([JSON.stringify(configuration, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agent-profile-model-catalog-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'ok', text: '配置已导出到本地 JSON 文件。' });
    } catch (error) {
      setFeedback({ kind: 'err', text: `导出失败：${String(error)}` });
    }
  }

  async function importConfiguration(file: File): Promise<void> {
    try {
      const configuration = JSON.parse(await file.text()) as ModelCatalogConfiguration;
      if (configuration.schemaVersion !== 'model-catalog/v1') {
        throw new Error('只支持 model-catalog/v1 配置');
      }
      const response = await fetch(`${API}/model-catalog/configuration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(configuration),
      });
      await responseJson(response);
      await reloadSelected('配置已导入；历史记录保留，当前模型列表已刷新。');
    } catch (error) {
      setFeedback({ kind: 'err', text: `导入失败：${String(error)}` });
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <div className={styles.heading}>
          <div>
            <div className={styles.eyebrow}>Model Catalog</div>
            <h1>模型与成本配置</h1>
            <p>
              按原始模型身份维护四类 Token
              价格和上下文窗口。配置变更不会自动重写历史成本；需要先预览，再显式执行重算。
            </p>
          </div>
          <div className={styles.topActions}>
            <button className={styles.button} type="button" onClick={exportConfiguration}>
              导出配置
            </button>
            <button
              className={styles.button}
              type="button"
              onClick={() => importInput.current?.click()}
            >
              导入配置
            </button>
            <input
              ref={importInput}
              className={styles.visuallyHidden}
              type="file"
              accept="application/json,.json"
              aria-label="选择 Model Catalog JSON 配置"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importConfiguration(file);
              }}
            />
          </div>
        </div>

        {feedback && (
          <div aria-live="polite" style={{ marginBottom: 12 }}>
            <Notice kind={feedback.kind}>{feedback.text}</Notice>
          </div>
        )}

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Observed 模型列表">
            <div className={styles.sidebarHead}>
              <label htmlFor="model-search">查找原始模型身份</label>
              <input
                id="model-search"
                type="search"
                value={query}
                placeholder="例如 gpt-4o"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className={styles.modelList}>
              {isLoading && <div className={styles.empty}>正在加载模型目录…</div>}
              {!isLoading && filteredModels.length === 0 && (
                <div className={styles.empty}>没有匹配的 observed 模型。</div>
              )}
              {filteredModels.map((item) => {
                const priority = priorityLabel(item);
                return (
                  <button
                    key={item.model}
                    className={styles.modelButton}
                    type="button"
                    aria-current={selected?.model === item.model}
                    onClick={() => selectModel(item.model)}
                  >
                    <span className={styles.modelName}>{item.model}</span>
                    <span className={styles.modelMeta}>
                      <span>{priority.text}</span>
                      <span className="tnum">{item.observedSpans} spans</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className={styles.content} aria-live="polite">
            {!selected || !inventory ? (
              <div className={styles.panel}>
                <div className={styles.empty}>暂无 observed 模型可配置。</div>
              </div>
            ) : (
              <ModelEditor
                key={`${selected.model}:${selected.pricing?.revision ?? 0}:${selected.context?.revision ?? 0}`}
                item={selected}
                history={history}
                pricingRevision={inventory.pricingRevision}
                onReload={reloadSelected}
                onFeedback={setFeedback}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function ModelEditor({
  item,
  history,
  pricingRevision,
  onReload,
  onFeedback,
}: {
  item: ModelCatalogInventoryItem;
  history: ModelCatalogPricingRecord[];
  pricingRevision: string;
  onReload: (message?: string) => Promise<void>;
  onFeedback: (feedback: Feedback) => void;
}) {
  const [pricingDraft, setPricingDraft] = useState(() => createPricingDraft(item));
  const [contextWindow, setContextWindow] = useState(
    item.context ? String(item.context.contextWindow) : '',
  );
  const [contextReference, setContextReference] = useState(item.context?.sourceReference ?? '');
  const [pricingError, setPricingError] = useState('');
  const [contextError, setContextError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<ModelCatalogRecalculationPreview | null>(null);
  const [result, setResult] = useState<ModelCatalogRecalculationResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const priority = priorityLabel(item);

  function updatePricing(field: keyof PricingDraft, value: string): void {
    setPricingDraft((current) => ({ ...current, [field]: value }));
    setPricingError('');
  }

  async function savePricing(): Promise<void> {
    const payload = buildPricingPayload(pricingDraft);
    if (!payload.ok) {
      setPricingError(payload.error);
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(
        `${API}/model-catalog/models/${encodeURIComponent(item.model)}/pricing`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload.value),
        },
      );
      await responseJson(response);
      setPreview(null);
      setResult(null);
      await onReload('价格 revision 已保存；历史成本尚未重算，请先查看下方预览。');
    } catch (error) {
      setPricingError(`保存失败：${String(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveContext(): Promise<void> {
    const parsed = Number(contextWindow);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setContextError('上下文窗口必须是大于 0 的整数。');
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(
        `${API}/model-catalog/models/${encodeURIComponent(item.model)}/context`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contextWindow: parsed,
            auditedAt: Date.now(),
            ...(contextReference.trim() ? { sourceReference: contextReference.trim() } : {}),
          }),
        },
      );
      await responseJson<ModelCatalogContextRecord>(response);
      await onReload('上下文规格已保存；后续分析将使用该精确原始模型配置。');
    } catch (error) {
      setContextError(`保存失败：${String(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function previewRecalculation(): Promise<void> {
    setIsPreviewing(true);
    setIsConfirmed(false);
    setResult(null);
    try {
      const response = await fetch(`${API}/model-catalog/recalculation/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: [item.model] }),
      });
      setPreview(await responseJson<ModelCatalogRecalculationPreview>(response));
    } catch (error) {
      onFeedback({ kind: 'err', text: `重算预览失败：${String(error)}` });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function executeRecalculation(): Promise<void> {
    if (!preview || !isPreviewCurrent(preview, pricingRevision) || !isConfirmed) return;
    setIsExecuting(true);
    try {
      const response = await fetch(`${API}/model-catalog/recalculation/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: preview.scope, pricingRevision: preview.pricingRevision }),
      });
      const executed = await responseJson<ModelCatalogRecalculationResult>(response);
      setResult(executed);
      setPreview(executed);
      setIsConfirmed(false);
      onFeedback({ kind: 'ok', text: '历史成本重算完成，Session 汇总已同步更新。' });
    } catch (error) {
      const message = String(error);
      if (message.includes('pricing_revision_changed')) {
        setPreview(null);
        onFeedback({ kind: 'err', text: '价格 revision 已变化；已阻止执行，请重新生成预览。' });
        await onReload();
      } else {
        onFeedback({ kind: 'err', text: `重算执行失败：${message}` });
      }
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.modelHeader}>
        <div>
          <h2>{item.model}</h2>
          <p>精确原始模型身份；不会按 provider 名称或相似字符串自动映射价格。</p>
        </div>
        <div className={styles.chipRow}>
          <Chip color={priority.color}>{priority.text}</Chip>
          <Chip color={C.link}>{item.observedSessions} Sessions</Chip>
          {item.pricingAlias && <Chip color={C.cc}>等价于 {item.pricingAlias.pricingModel}</Chip>}
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <Summary label="Observed spans" value={String(item.observedSpans)} />
        <Summary label="最近观测" value={formatCatalogDate(item.latestObservedAt)} />
        <Summary label="价格来源" value={item.pricing?.sourceKind ?? '未捕获'} />
        <Summary
          label="上下文来源"
          value={
            item.context
              ? `${item.context.sourceKind}${item.context.userOverride ? ' · override' : ''}`
              : '未捕获'
          }
        />
      </div>

      {item.pricing?.status === 'unsupported' && (
        <Notice kind="err">
          当前 pricing scheme 不受计算器支持，仍按未知成本处理；保存有效四类价格 revision
          后才可预览重算。
        </Notice>
      )}

      <div className={styles.editorGrid}>
        <section className={styles.editor} aria-labelledby="pricing-editor-title">
          <h3 id="pricing-editor-title">四类 Token 价格</h3>
          <p className={styles.helper}>
            单位：CNY / 1,000,000 tokens。保存会新增 revision，不删除历史。
          </p>
          <div className={styles.priceGrid}>
            <Field
              label="Input"
              value={pricingDraft.inputPrice}
              onChange={(value) => updatePricing('inputPrice', value)}
            />
            <Field
              label="Cache creation"
              value={pricingDraft.cacheCreationPrice}
              onChange={(value) => updatePricing('cacheCreationPrice', value)}
            />
            <Field
              label="Cache read"
              value={pricingDraft.cacheReadPrice}
              onChange={(value) => updatePricing('cacheReadPrice', value)}
            />
            <Field
              label="Output"
              value={pricingDraft.outputPrice}
              onChange={(value) => updatePricing('outputPrice', value)}
            />
            <Field
              label="生效时间（本地）"
              type="datetime-local"
              value={pricingDraft.effectiveAt}
              onChange={(value) => updatePricing('effectiveAt', value)}
            />
            <Field
              label="来源 / 审计引用"
              type="text"
              value={pricingDraft.sourceReference}
              onChange={(value) => updatePricing('sourceReference', value)}
            />
          </div>
          {pricingDraft.effectiveAt && (
            <p className={styles.helper}>
              提交为 UTC：{new Date(pricingDraft.effectiveAt).toISOString()}
            </p>
          )}
          {pricingError && (
            <div className={styles.fieldError} role="alert">
              {pricingError}
            </div>
          )}
          <div className={styles.actionRow}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={isSaving || isExecuting}
              onClick={savePricing}
            >
              {isSaving ? '保存中…' : '保存价格 revision'}
            </button>
          </div>
        </section>

        <section className={styles.editor} aria-labelledby="context-editor-title">
          <h3 id="context-editor-title">上下文规格</h3>
          <p className={styles.helper}>
            仅作用于这个原始模型身份；未配置保持未知，不按 provider 回退。
          </p>
          <div className={styles.priceGrid}>
            <Field
              label="Context window（tokens）"
              value={contextWindow}
              onChange={(value) => {
                setContextWindow(value);
                setContextError('');
              }}
            />
            <Field
              label="来源 / 审计引用"
              type="text"
              value={contextReference}
              onChange={(value) => {
                setContextReference(value);
                setContextError('');
              }}
            />
          </div>
          {contextError && (
            <div className={styles.fieldError} role="alert">
              {contextError}
            </div>
          )}
          <div className={styles.actionRow}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={isSaving || isExecuting}
              onClick={saveContext}
            >
              {isSaving ? '保存中…' : '保存上下文规格'}
            </button>
          </div>
        </section>
      </div>

      <section className={styles.recalculation} aria-labelledby="recalculation-title">
        <h3 id="recalculation-title">历史成本重算</h3>
        <p className={styles.helper}>
          范围固定为当前精确模型。Preview 只读；执行会事务性更新匹配 Span 与 Session 汇总。
        </p>
        <div className={styles.actionRow}>
          <button
            className={styles.button}
            type="button"
            disabled={isSaving || isPreviewing || isExecuting}
            onClick={previewRecalculation}
          >
            {isPreviewing ? '生成预览中…' : '生成重算预览'}
          </button>
        </div>
        {preview && (
          <>
            <div className={styles.coverageGrid}>
              <Coverage label="影响 Spans" value={preview.after.spans} />
              <Coverage label="影响 Sessions" value={preview.after.sessions} />
              <Coverage label="重算后已知" value={preview.after.known} />
              <Coverage label="重算后未知" value={preview.after.unknown} />
            </div>
            {preview.unsupportedModels.length > 0 && (
              <div className={styles.fieldError} role="alert">
                仍不支持：{preview.unsupportedModels.join('、')}
              </div>
            )}
            {!result && (
              <label className={styles.confirmation}>
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(event) => setIsConfirmed(event.target.checked)}
                />
                我确认按此 preview 更新 {preview.after.spans} 个 Span；该操作不会自动撤销。
              </label>
            )}
            <div className={styles.actionRow}>
              {result ? (
                <span className={styles.helper}>
                  完成：{result.updatedSpans} Spans / {result.updatedSessions} Sessions
                </span>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={
                    !isConfirmed || isExecuting || !isPreviewCurrent(preview, pricingRevision)
                  }
                  onClick={executeRecalculation}
                >
                  {isExecuting ? '执行中…' : '确认并执行重算'}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className={styles.history} aria-labelledby="pricing-history-title">
        <h3 id="pricing-history-title">价格 revision 历史</h3>
        {history.length === 0 ? (
          <p className={styles.empty}>尚无价格历史。</p>
        ) : (
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th>Revision</th>
                <th>状态</th>
                <th>生效时间</th>
                <th>Input</th>
                <th>Cache create</th>
                <th>Cache read</th>
                <th>Output</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={`${row.effectiveFrom}:${row.revision}`}>
                  <td className="tnum">{row.revision}</td>
                  <td>{row.status}</td>
                  <td>{formatCatalogDate(row.effectiveFrom)}</td>
                  <td className="tnum">{row.inputPrice}</td>
                  <td className="tnum">{row.cacheCreationPrice}</td>
                  <td className="tnum">{row.cacheReadPrice}</td>
                  <td className="tnum">{row.outputPrice}</td>
                  <td>{row.sourceKind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'number',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'number' | 'datetime-local' | 'text';
}) {
  return (
    <div className={styles.field}>
      <label>
        <span className={styles.fieldLabel}>{label}</span>
        <input
          type={type}
          min={type === 'number' ? 0 : undefined}
          step={type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Coverage({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.coverageItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

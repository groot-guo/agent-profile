'use client';

import type {
  ModelCatalogConfiguration,
  ModelCatalogInventoryItem,
  ModelCatalogPricingRecord,
} from '@agent-profile/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { API } from '../../config';
import { Notice } from '../../ui';
import {
  catalogIdentityGroup,
  identityGroupLabel,
  sortCatalogModels,
  type CatalogIdentityGroup,
} from './model-catalog';
import styles from './model-catalog.module.css';
import { type Feedback, ModelEditor, priorityLabel, responseJson } from './model-editor';

interface InventoryResponse {
  schemaVersion: 'model-catalog/v1';
  pricingRevision: string;
  models: ModelCatalogInventoryItem[];
}

interface HistoryResponse {
  model: string;
  schedules: ModelCatalogPricingRecord[];
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
              {groupCatalogModels(filteredModels).map(([group, items]) => (
                <div key={group} className={styles.identityGroup}>
                  <div className={styles.identityGroupLabel}>{identityGroupLabel(group)}</div>
                  {items.map((item) => {
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
              ))}
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

function groupCatalogModels(
  models: ModelCatalogInventoryItem[],
): Array<[CatalogIdentityGroup, ModelCatalogInventoryItem[]]> {
  const groups: Record<CatalogIdentityGroup, ModelCatalogInventoryItem[]> = {
    billable: [],
    review: [],
    excluded: [],
  };
  for (const item of models) groups[catalogIdentityGroup(item)].push(item);
  return (['billable', 'review', 'excluded'] as const).map((group) => [
    group,
    groups[group],
  ]);
}

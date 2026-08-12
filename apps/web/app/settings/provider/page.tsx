'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { API } from '../../config';
import {
  defaultProviderConfiguration,
  endpointLocalityLabel,
  loadProviderStatus,
  type ProviderConfigurationInput,
  type ProviderKind,
  type ProviderStatus,
  providerLabel,
  providerTestLabel,
  saveProviderConfiguration,
  testProvider,
} from '../../provider-config';
import { C, FS, R, SP } from '../../theme';
import { Card, Notice } from '../../ui';

const FIELD_STYLE = {
  width: '100%',
  minHeight: 42,
  padding: '9px 11px',
  border: `1px solid ${C.border}`,
  borderRadius: R.md,
  background: C.bg,
  color: C.text,
  font: 'inherit',
  fontSize: FS.sm,
  boxSizing: 'border-box' as const,
};

const DEFAULT_FORM: ProviderConfigurationInput = {
  ...defaultProviderConfiguration('openai'),
  apiKey: '',
};

export default function ProviderSettingsPage() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [form, setForm] = useState<ProviderConfigurationInput>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadProviderStatus(API, (url, init) => fetch(url, { ...init, signal: controller.signal }))
      .then((nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.provider) {
          const defaults = defaultProviderConfiguration(nextStatus.provider);
          setForm((current) => ({
            ...current,
            ...defaults,
            baseUrl: nextStatus.endpointUrl || defaults.baseUrl,
            model: nextStatus.model || defaults.model,
          }));
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFeedback({ kind: 'err', text: `Provider 状态读取失败：${errorMessage(error)}` });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function updateProvider(provider: ProviderKind): void {
    const defaults = defaultProviderConfiguration(provider);
    setForm((current) => ({ ...current, ...defaults, apiKey: current.apiKey }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.baseUrl.trim() || !form.model.trim() || !form.apiKey.trim()) {
      setFeedback({ kind: 'err', text: '请填写完整的 Base URL、模型和 API key。' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const result = await saveProviderConfiguration(API, {
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey.trim(),
      });
      setStatus(result.status);
      setForm((current) => ({ ...current, apiKey: '' }));
      setFeedback({
        kind: result.test.status === 'passed' ? 'ok' : 'err',
        text:
          result.test.status === 'passed'
            ? 'Provider 已保存且连接测试通过。API key 不会返回到页面；现在可返回 Session 运行语义诊断。'
            : `Provider 已保存，但${providerTestLabel(result.test)}。请检查配置后重新测试。`,
      });
    } catch (error: unknown) {
      setFeedback({ kind: 'err', text: `Provider 保存失败：${errorMessage(error)}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await testProvider(API);
      setStatus(result.status);
      setFeedback({
        kind: result.test.status === 'passed' ? 'ok' : 'err',
        text: providerTestLabel(result.test),
      });
    } catch (error: unknown) {
      setFeedback({ kind: 'err', text: `Provider 测试失败：${errorMessage(error)}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main style={{ minHeight: 'calc(100dvh - var(--header-h))', padding: SP.xl, background: C.bg }}>
      <div style={{ width: 'min(900px, 100%)', margin: '0 auto' }}>
        <div style={{ marginBottom: SP.xl }}>
          <div style={{ color: C.link, fontSize: FS.cap, fontWeight: 700, letterSpacing: 1 }}>
            SEMANTIC PROVIDER
          </div>
          <h1 style={{ margin: `${SP.xs}px 0`, color: C.text, fontSize: 24 }}>语义诊断 Provider</h1>
          <p style={{ maxWidth: 720, color: C.sub, fontSize: FS.sm, lineHeight: 1.7 }}>
            语义诊断是可选的 Provider 增强能力；未配置时仍可使用本地确定性诊断。保存后，API key
            只提交给本机 Server，并由 Server 写入权限为 0600 的配置文件，不进入浏览器存储、SQLite 或
            audit。
          </p>
        </div>

        {feedback && <Notice kind={feedback.kind}>{feedback.text}</Notice>}

        <Card title="当前状态" meta={loading ? '读取中…' : undefined}>
          {status ? (
            <div style={{ display: 'grid', gap: SP.sm, color: C.sub, fontSize: FS.sm }}>
              <div>
                状态：
                <strong style={{ color: status.configured ? C.cr : C.medium }}>
                  {status.configured ? '已配置' : '未配置'}
                </strong>
              </div>
              <div>Provider：{providerLabel(status.provider)}</div>
              <div>模型：{status.model || '未设置'}</div>
              <div>
                Endpoint：{status.endpointHost || '未设置'} ·{' '}
                {endpointLocalityLabel(status.endpointLocality)}
              </div>
              <div>
                来源：
                {status.configSource === 'file'
                  ? 'Server 配置文件'
                  : status.configSource === 'env'
                    ? '环境变量'
                    : '无'}
              </div>
              {status.configured && (
                <div style={{ color: C.mute }}>
                  当前测试状态：
                  {status.testStatus === 'passed'
                    ? '通过'
                    : status.testStatus === 'failed'
                      ? '失败'
                      : '未测试'}
                  。
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: C.sub, fontSize: FS.sm }}>正在读取 Provider 状态…</div>
          )}
        </Card>

        <Card title="配置 Provider">
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: SP.md }}>
            <label style={labelStyle}>
              Provider 协议
              <select
                value={form.provider}
                onChange={(event) => updateProvider(event.target.value as ProviderKind)}
                style={FIELD_STYLE}
              >
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic-native</option>
              </select>
            </label>
            <label style={labelStyle}>
              Base URL
              <input
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, baseUrl: event.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                type="url"
                style={FIELD_STYLE}
              />
            </label>
            <label style={labelStyle}>
              模型 ID
              <input
                value={form.model}
                onChange={(event) =>
                  setForm((current) => ({ ...current, model: event.target.value }))
                }
                placeholder="gpt-4o-mini"
                type="text"
                style={FIELD_STYLE}
              />
            </label>
            <label style={labelStyle}>
              API key
              <input
                value={form.apiKey}
                onChange={(event) =>
                  setForm((current) => ({ ...current, apiKey: event.target.value }))
                }
                autoComplete="off"
                placeholder="只在提交时发送，不会回显"
                type="password"
                style={FIELD_STYLE}
              />
            </label>
            <div style={{ color: C.mute, fontSize: FS.cap, lineHeight: 1.6 }}>
              保存会发出一次最小 probe 请求，可能消耗极少量 token。当前支持两种 wire protocol：
              OpenAI-compatible（`/chat/completions`，可覆盖 OpenAI、DeepSeek 和兼容网关）以及
              Anthropic-native（`/messages`）。Gemini、Azure 原生协议、Ollama 原生协议等尚未实现；
              Base URL 和模型必须与服务商实际接口匹配；模型 ID 必须在当前 API key 可用的模型列表中。
            </div>
            <button
              type="submit"
              disabled={saving || loading}
              style={{
                width: 'fit-content',
                padding: '8px 16px',
                border: 0,
                borderRadius: R.md,
                background: C.link,
                color: '#fff',
                cursor: saving || loading ? 'default' : 'pointer',
                opacity: saving || loading ? 0.6 : 1,
                fontSize: FS.sm,
              }}
            >
              {saving ? '保存中…' : '保存 Provider 配置'}
            </button>
            {status?.configured && (
              <button
                type="button"
                disabled={testing || saving || loading}
                onClick={() => void handleTest()}
                style={{
                  width: 'fit-content',
                  padding: '8px 16px',
                  border: `1px solid ${C.border}`,
                  borderRadius: R.md,
                  background: C.card,
                  color: C.text,
                  cursor: testing || saving || loading ? 'default' : 'pointer',
                  opacity: testing || saving || loading ? 0.6 : 1,
                  fontSize: FS.sm,
                }}
              >
                {testing ? '测试中…' : '重新测试连接'}
              </button>
            )}
          </form>
        </Card>

        <Card title="运行步骤">
          <ol
            style={{ margin: 0, paddingLeft: 20, color: C.sub, fontSize: FS.sm, lineHeight: 1.8 }}
          >
            <li>在上方保存 Provider 配置，并确认状态变为“已配置”。</li>
            <li>回到 Session 详情的“诊断建议”，点击“允许并运行语义诊断”。</li>
            <li>只有显式点击后才会发送有界、脱敏的标题、thinking 摘要和工具输入。</li>
            <li>没有 token/model 遥测的 Session 会显示“证据不足”，不会强行调用 Provider。</li>
          </ol>
          <Link
            href="/"
            style={{ display: 'inline-block', marginTop: SP.md, color: C.link, fontSize: FS.sm }}
          >
            返回会话列表 →
          </Link>
        </Card>
      </div>
    </main>
  );
}

const labelStyle = {
  display: 'grid',
  gap: SP.xs,
  color: C.sub,
  fontSize: FS.sm,
  fontWeight: 600,
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

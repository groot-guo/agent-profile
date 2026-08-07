import type { DiagnosisResult } from '@agent-profile/core';
import { C, DIAG_LABEL, FS, fmtTokens, R, SEV_COLOR, SEV_LABEL, SP } from '../../theme';
import { Chip, Empty, SoftButton } from '../../ui';

export function DiagnosisList({
  result,
  onEvidenceRequest,
}: {
  result: DiagnosisResult | null;
  onEvidenceRequest: (spanIds: string[]) => void;
}) {
  if (!result) return <Empty text="诊断不可用" hint="server 未返回诊断结果" />;
  if (result.findings.length === 0) {
    return <div style={{ color: C.cr, fontSize: FS.sm }}>✓ 未发现明显可优化项</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
      {result.findings.map((f, i) => (
        <div
          key={f.spanIds[0] ? `${f.type}-${f.spanIds[0]}` : i}
          style={{
            borderRadius: R.md,
            padding: SP.md,
            boxShadow: `inset 3px 0 0 ${SEV_COLOR[f.severity]}`,
            background: `${SEV_COLOR[f.severity]}0A`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: SP.md,
            }}
          >
            <div
              style={{
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: SP.sm,
                flexWrap: 'wrap',
              }}
            >
              <Chip color={SEV_COLOR[f.severity]}>
                {SEV_LABEL[f.severity] || f.severity} · {DIAG_LABEL[f.type]}
              </Chip>
              <span style={{ fontSize: FS.base, color: C.text, fontWeight: 600 }}>{f.title}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="tnum" style={{ fontSize: FS.base, fontWeight: 600, color: C.cc }}>
                ~{fmtTokens(f.wastedTokens)}
              </div>
              <div
                className="tnum"
                style={{ fontSize: FS.cap, color: f.costUnknown ? C.medium : C.mute }}
              >
                {f.costUnknown ? '未定价' : `¥${f.wastedCost.toFixed(5)}`}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: FS.sm,
              color: C.sub,
              marginTop: SP.sm,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            {f.detail}
          </div>
          <div
            style={{
              fontSize: FS.sm,
              color: C.cr,
              marginTop: SP.xs,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            💡 {f.suggestion}
          </div>
          <div style={{ marginTop: SP.sm }}>
            {f.spanIds.length > 0 ? (
              <button
                type="button"
                onClick={() => onEvidenceRequest(f.spanIds)}
                style={{
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: C.link,
                  cursor: 'pointer',
                  fontSize: FS.cap,
                }}
              >
                查看 {f.spanIds.length} 个关联证据 Span →
              </button>
            ) : (
              <span style={{ color: C.mute, fontSize: FS.cap }}>
                关联证据不可用：当前 finding 没有 Span 引用
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SemanticDiagnosisDisclosure({
  report,
  loading,
  error,
  onRequest,
}: {
  report: DiagnosisResult['semantic'];
  loading: boolean;
  error: string;
  onRequest: () => void;
}) {
  if (!report || report.status === 'not_requested') {
    return (
      <div
        style={{
          marginBottom: SP.lg,
          padding: SP.md,
          border: `1px solid ${C.border}`,
          borderRadius: R.md,
          background: `${C.link}08`,
        }}
      >
        <div style={{ color: C.text, fontWeight: 600, fontSize: FS.sm }}>语义诊断（可选）</div>
        <div style={{ color: C.sub, fontSize: FS.cap, lineHeight: 1.6, marginTop: SP.xs }}>
          默认只运行本地 deterministic 诊断。开启后，仅会把有界、脱敏的任务标题、thinking
          摘要和工具输入发送到已配置的 Provider；Provider
          地址的本地性不会由本地进程验证，原始内容不会写入 audit。
        </div>
        {error && (
          <div style={{ color: C.medium, fontSize: FS.cap, marginTop: SP.xs }}>{error}</div>
        )}
        <SoftButton
          variant="primary"
          disabled={loading}
          onClick={onRequest}
          style={{ marginTop: SP.sm }}
        >
          {loading ? '请求中…' : '允许并运行语义诊断'}
        </SoftButton>
      </div>
    );
  }

  const status =
    report.status === 'completed'
      ? `已完成 · ${report.provider || 'Provider'} · ${report.payload.redactions} 处脱敏`
      : report.status === 'not_configured'
        ? '未配置 Provider，未发送内容'
        : 'Provider 请求失败，已保留本地诊断';
  return (
    <div
      style={{
        marginBottom: SP.lg,
        padding: SP.md,
        borderRadius: R.md,
        background: report.status === 'completed' ? `${C.cr}0A` : `${C.medium}12`,
        color: C.sub,
        fontSize: FS.cap,
        lineHeight: 1.6,
      }}
    >
      <div style={{ color: C.text, fontWeight: 600 }}>{status}</div>
      <div>
        Provider payload：{report.payload.thinkingItems} 个 thinking、{report.payload.toolItems}{' '}
        个工具输入，
        {report.payload.characters} 字符；只保留有界、脱敏的本地 audit metadata。
      </div>
      {report.limitations.map((limitation) => (
        <div key={limitation}>· {limitation}</div>
      ))}
    </div>
  );
}

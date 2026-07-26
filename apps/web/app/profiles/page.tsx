'use client';

import type {
  AgentProcessProfile,
  AgentProfileReport,
  ProfileUnit,
  RelativeCharacteristic,
} from '@agent-profile/core';
import { useEffect, useMemo, useState } from 'react';
import { API } from '../config';
import { getAgentIcon } from '../icons';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtDuration, fmtTokens, R, SP } from '../theme';
import { Card, Chip, Empty, Notice } from '../ui';

interface SignatureMetric {
  id: string;
  label: string;
  value: number | null;
  unit: ProfileUnit;
  color: string;
}

export default function ProfilesPage() {
  const [report, setReport] = useState<AgentProfileReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/profiles/agents`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AgentProfileReport>;
      })
      .then(setReport)
      .catch((reason) => setError(reason instanceof Error ? reason.message : '画像加载失败'));
  }, []);

  const maxima = useMemo(() => {
    const result: Record<string, number> = {};
    for (const profile of report?.profiles ?? []) {
      for (const metric of signatureMetrics(profile)) {
        if (metric.value !== null) {
          result[metric.id] = Math.max(result[metric.id] ?? 0, metric.value);
        }
      }
    }
    return result;
  }, [report]);

  if (error) {
    return (
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
        <Notice kind="err">画像加载失败：{error}。确认本地 API 服务正在运行。</Notice>
      </main>
    );
  }
  if (!report) {
    return (
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
        <Empty text="正在生成 Agent 运行画像…" />
      </main>
    );
  }
  if (report.profiles.length === 0) {
    return (
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
        <ProfileIntro report={report} />
        <Card>
          <Empty
            text="还没有可画像的 Session"
            hint="先导入至少一个 Agent 的运行记录；每个 Agent 至少 3 个 Session 后才会生成相对差异。"
          />
        </Card>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
      <ProfileIntro report={report} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: SP.lg,
          alignItems: 'start',
        }}
      >
        {report.profiles.map((profile) => (
          <ProfileCard key={profile.agent} profile={profile} maxima={maxima} />
        ))}
      </div>

      <Card title="如何读取这些差异" meta={report.schemaVersion}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: SP.lg,
          }}
        >
          <Explanation
            title="比较单位"
            body="每个指标先在 Agent 自己的 Session 内求中位数或比率，再与符合样本要求的其他 Agent 指标中位数比较。"
          />
          <Explanation
            title="相似范围"
            body={`与同类中位数相差不超过 ${(report.comparison.similarityThreshold * 100).toFixed(0)}% 时标记为“接近”。高于或低于只描述行为，不代表好坏。`}
          />
          <Explanation
            title="当前缺口"
            body="尚未采集任务类型、复杂度和最终 Outcome。页面能解释运行方式的差异，不能证明谁完成得更正确。"
          />
        </div>
      </Card>
    </main>
  );
}

function ProfileIntro({ report }: { report: AgentProfileReport }) {
  return (
    <section style={{ marginBottom: SP.xl }}>
      <div
        className="tnum"
        style={{
          color: C.mute,
          fontSize: FS.cap,
          letterSpacing: 0.8,
          marginBottom: SP.sm,
        }}
      >
        runtime / agents / observed profile
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: SP.xl,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ maxWidth: 720 }}>
          <h1
            style={{
              margin: 0,
              color: C.text,
              fontSize: 26,
              lineHeight: 1.2,
              letterSpacing: -0.6,
            }}
          >
            运行画像，不是排行榜
          </h1>
          <p
            style={{
              color: C.sub,
              fontSize: FS.base,
              lineHeight: 1.75,
              margin: `${SP.sm}px 0 0`,
            }}
          >
            用统一的运行指纹观察资源、上下文、工具可靠性与协作方式。每个差异都附带样本与覆盖度；
            最终交付质量仍需 Task Outcome 证据。
          </p>
        </div>
        <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap' }}>
          <Chip color={C.link}>{report.scope.agents.length} 个 Agent</Chip>
          <Chip color={C.cr}>{report.scope.sessions} 个 Session</Chip>
          <Chip color={report.comparison.status === 'ready' ? C.out : C.medium}>
            {report.comparison.status === 'ready' ? '可做相对比较' : '样本不足'}
          </Chip>
        </div>
      </div>
    </section>
  );
}

function ProfileCard({
  profile,
  maxima,
}: {
  profile: AgentProcessProfile;
  maxima: Record<string, number>;
}) {
  const color = AGENT_COLORS[profile.agent] ?? C.link;
  const characteristics = profile.relativeCharacteristics;
  return (
    <article
      style={{
        background: C.card,
        borderRadius: R.lg,
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        border: `1px solid ${C.borderSoft}`,
      }}
    >
      <div style={{ height: 4, background: color }} />
      <div style={{ padding: SP.lg }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: SP.sm,
            marginBottom: SP.md,
          }}
        >
          {getAgentIcon(profile.agent, 22)}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.text, fontSize: 16, fontWeight: 650 }}>
              {AGENT_LABELS[profile.agent] ?? profile.agent}
            </div>
            <div className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
              {profile.agent}
            </div>
          </div>
          <Chip color={profile.comparisonStatus === 'ready' ? C.cr : C.medium}>
            {profile.comparisonStatus === 'ready' ? '可比较' : '样本不足'}
          </Chip>
        </div>

        <div
          className="tnum"
          style={{
            display: 'flex',
            gap: SP.lg,
            color: C.sub,
            fontSize: FS.cap,
            paddingBottom: SP.md,
            borderBottom: `1px solid ${C.borderSoft}`,
          }}
        >
          <span>{profile.sample.sessions} sessions</span>
          <span>{profile.sample.llmTurns} turns</span>
          <span>{profile.sample.toolCalls} tools</span>
        </div>

        <div style={{ marginTop: SP.lg }}>
          <SmallHeading>运行指纹</SmallHeading>
          {signatureMetrics(profile).map((metric) => (
            <SignatureRail key={metric.id} metric={metric} maximum={maxima[metric.id] ?? 0} />
          ))}
        </div>

        <div style={{ marginTop: SP.lg }}>
          <SmallHeading>相对同类</SmallHeading>
          {characteristics.length > 0 ? (
            <div style={{ display: 'grid', gap: SP.sm }}>
              {characteristics.map((characteristic) => (
                <CharacteristicRow key={characteristic.metric} characteristic={characteristic} />
              ))}
            </div>
          ) : (
            <div
              style={{
                color: C.mute,
                fontSize: FS.sm,
                lineHeight: 1.6,
                padding: `${SP.sm}px 0`,
              }}
            >
              至少需要 3 个 Session，并且存在另一个满足样本要求的 Agent。
            </div>
          )}
        </div>

        <div style={{ marginTop: SP.lg }}>
          <SmallHeading>证据覆盖</SmallHeading>
          <CoverageGrid profile={profile} />
        </div>

        {profile.limitations.length > 0 && (
          <div
            style={{
              marginTop: SP.lg,
              padding: SP.md,
              borderRadius: R.md,
              background: `${C.medium}0D`,
              color: C.sub,
              fontSize: FS.cap,
              lineHeight: 1.6,
            }}
          >
            {profile.limitations.join(' ')}
          </div>
        )}
      </div>
    </article>
  );
}

function signatureMetrics(profile: AgentProcessProfile): SignatureMetric[] {
  return [
    {
      id: 'tokens',
      label: 'Session token 中位',
      value: profile.dimensions.resourceUsage.tokensPerSession.median,
      unit: 'tokens',
      color: C.input,
    },
    {
      id: 'context',
      label: '峰值上下文中位',
      value: profile.dimensions.contextDiscipline.peakContextPerSession.median,
      unit: 'tokens',
      color: C.cc,
    },
    {
      id: 'tool-errors',
      label: '已观察工具错误率',
      value: profile.dimensions.executionReliability.toolErrorRate.value,
      unit: 'ratio',
      color: C.high,
    },
    {
      id: 'sidechain',
      label: 'Sidechain 工具占比',
      value: profile.dimensions.collaboration.sidechainToolShare.value,
      unit: 'ratio',
      color: C.cr,
    },
  ];
}

function SignatureRail({ metric, maximum }: { metric: SignatureMetric; maximum: number }) {
  const ratio = metric.value === null || maximum <= 0 ? 0 : metric.value / maximum;
  return (
    <div style={{ marginBottom: SP.sm }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: SP.md,
          color: C.sub,
          fontSize: FS.cap,
          marginBottom: 3,
        }}
      >
        <span>{metric.label}</span>
        <span className="tnum" style={{ color: C.text }}>
          {formatMetric(metric.value, metric.unit)}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: C.borderSoft,
          borderRadius: R.pill,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
            minWidth: metric.value !== null && metric.value > 0 ? 3 : 0,
            height: '100%',
            background: metric.color,
            borderRadius: R.pill,
          }}
        />
      </div>
    </div>
  );
}

function CharacteristicRow({ characteristic }: { characteristic: RelativeCharacteristic }) {
  const color =
    characteristic.direction === 'higher'
      ? C.out
      : characteristic.direction === 'lower'
        ? C.link
        : C.mute;
  const direction =
    characteristic.direction === 'higher'
      ? '高于'
      : characteristic.direction === 'lower'
        ? '低于'
        : '接近';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: SP.sm,
        alignItems: 'center',
        paddingBottom: SP.sm,
        borderBottom: `1px solid ${C.borderSoft}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="clamp1" style={{ color: C.text, fontSize: FS.sm }}>
          {metricLabel(characteristic.metric)}
        </div>
        <div className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
          {formatMetric(characteristic.value, characteristic.unit)} / 同类中位{' '}
          {formatMetric(characteristic.peerMedian, characteristic.unit)}
        </div>
      </div>
      <Chip
        color={color}
        tip={`${characteristic.evidence.agentSessions} 个本 Agent Session；${characteristic.evidence.peerAgents} 个同类 Agent；指标覆盖 ${(characteristic.evidence.targetCoverage * 100).toFixed(0)}%`}
      >
        {direction}
      </Chip>
    </div>
  );
}

function CoverageGrid({ profile }: { profile: AgentProcessProfile }) {
  const items = [
    ['成本', profile.coverage.knownCost.value],
    ['时长', profile.coverage.duration.value],
    ['模型', profile.coverage.modelIdentity.value],
    ['工具证据', profile.coverage.toolEvidence.value],
  ] as const;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: SP.sm,
      }}
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          style={{
            padding: `${SP.sm}px ${SP.xs}px`,
            textAlign: 'center',
            borderRadius: R.sm,
            background: C.borderSoft,
          }}
        >
          <div className="tnum" style={{ color: C.text, fontSize: FS.sm }}>
            {value === null ? '—' : `${(value * 100).toFixed(0)}%`}
          </div>
          <div style={{ color: C.mute, fontSize: 10, marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function SmallHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: C.sub,
        fontSize: FS.cap,
        fontWeight: 650,
        letterSpacing: 0.4,
        marginBottom: SP.sm,
      }}
    >
      {children}
    </div>
  );
}

function Explanation({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div style={{ color: C.text, fontSize: FS.sm, fontWeight: 650 }}>{title}</div>
      <div
        style={{
          color: C.sub,
          fontSize: FS.sm,
          lineHeight: 1.7,
          marginTop: SP.xs,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function metricLabel(metric: string): string {
  const labels: Record<string, string> = {
    'resource.tokens_per_session': 'Token / Session',
    'resource.cost_cny_per_session': '成本 / Session',
    'resource.duration_ms_per_session': '时长 / Session',
    'resource.cache_hit_rate': 'Cache 命中率',
    'context.peak_tokens_per_session': '峰值上下文',
    'reliability.tool_error_rate': '已观察工具错误率',
    'collaboration.sidechain_tool_share': 'Sidechain 工具占比',
  };
  return labels[metric] ?? metric;
}

function formatMetric(value: number | null, unit: ProfileUnit): string {
  if (value === null) return '—';
  if (unit === 'tokens') return fmtTokens(Math.round(value));
  if (unit === 'CNY') return `¥${value.toFixed(3)}`;
  if (unit === 'milliseconds') return fmtDuration(value);
  return `${(value * 100).toFixed(1)}%`;
}

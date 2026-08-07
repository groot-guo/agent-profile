import type { SessionDiscoveryItem } from '@agent-profile/contracts';
import { AgentMark } from './icons';
import { projectLabel } from './project-label';
import { activityLabel } from './session-activity';
import { sessionDisplayTitle } from './session-navigation';
import { C, FS, fmtAgo, R, SP } from './theme';
import { Chip, TokenStrip } from './ui';

export function SessionDetailLoading({ title }: { title?: string }) {
  return (
    <div className="session-detail-pending" aria-live="polite" role="status">
      <div className="session-detail-pending-kicker">正在打开会话</div>
      <strong className="clamp1" title={title}>
        {title ?? '准备运行分析'}
      </strong>
      <span>正在读取有界会话分析；已保留当前选择与返回路径。</span>
      <div className="session-detail-pending-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function SessionListSkeleton() {
  const rows = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="正在加载会话"
      style={{ padding: `0 ${SP.lg}px` }}
    >
      {rows.map((row, index) => (
        <div
          key={row}
          style={{
            height: 48,
            marginBottom: SP.sm,
            borderRadius: R.md,
            background: C.borderSoft,
            opacity: 1 - index * 0.07,
          }}
        />
      ))}
    </div>
  );
}

export function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronGlyph() {
  return (
    <svg
      className="session-filter-chevron"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreGlyph() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 扁平三行布局:L1 名称;L2 项目;L3 agent · 时间 · 指纹条 · 费用/标记
export function SessionRow({
  s,
  project,
  selected,
  anomaly,
  activityState,
  onSelect,
}: {
  s: SessionDiscoveryItem;
  project: string;
  selected: boolean;
  anomaly: boolean;
  activityState: SessionDiscoveryItem['activityState'];
  onSelect: (id: string) => void;
}) {
  const name = sessionDisplayTitle(s);
  const activity = activityLabel(activityState);
  return (
    <button
      type="button"
      onClick={() => onSelect(s.id)}
      className="session-row ap-row"
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
    >
      <div
        className="clamp1"
        title={name}
        style={{
          fontSize: FS.sm,
          fontWeight: selected ? 600 : 400,
          color: selected ? C.link : C.text,
        }}
      >
        {name}
      </div>
      <div
        className="clamp1"
        title={project}
        style={{ marginTop: 2, color: C.mute, fontSize: FS.cap }}
      >
        {projectLabel(project)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <AgentMark agent={s.agent} size={20} />
        <span className="tnum" style={{ fontSize: FS.cap, color: C.mute, flexShrink: 0 }}>
          {fmtAgo(s.startTime)}
        </span>
        <TokenStrip
          input={s.inputTokens}
          cc={s.cacheCreationTokens}
          cr={s.cacheReadTokens}
          out={s.outputTokens}
          tipMode="native"
        />
        {activity && (
          <Chip
            color={activityState === 'updating' ? C.cr : C.link}
            tipMode="native"
            tip="基于本地来源 revision 的最近变化推断；不表示来源进程已确认结束"
          >
            {activity}
          </Chip>
        )}
        {anomaly && (
          <Chip color={C.high} tipMode="native" tip="成本超过该项目 3× 中位数,建议查看诊断">
            异常
          </Chip>
        )}
        {s.costUnknownCount > 0 ? (
          <Chip color={C.medium} tipMode="native" tip="包含未定价模型,成本无法计算">
            未定价
          </Chip>
        ) : (
          <span className="tnum" style={{ fontSize: FS.cap, color: C.sub, flexShrink: 0 }}>
            ¥{s.totalCost.toFixed(2)}
          </span>
        )}
      </div>
    </button>
  );
}

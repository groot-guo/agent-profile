// 共享 UI 原语 —— 所有页面只用这里的组件 + theme.ts token
// 规范:docs/ui-guidelines.md
'use client';

import type { CSSProperties, ReactNode } from 'react';
import { C, FS, R, SHADOW, SP } from './theme';

// ---------- Card:内容分组容器,可选标题与右侧 meta ----------
export function Card({
  title,
  meta,
  children,
  pad = SP.lg,
  style,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.card,
        borderRadius: R.lg,
        boxShadow: SHADOW.card,
        padding: pad,
        marginBottom: SP.xl,
        ...style,
      }}
    >
      {title != null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: SP.md,
            marginBottom: SP.md,
          }}
        >
          <div style={{ fontSize: FS.title, fontWeight: 600, color: C.text }}>{title}</div>
          {meta != null && (
            <div className="tnum" style={{ fontSize: FS.cap, color: C.mute, flexShrink: 0 }}>
              {meta}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

// ---------- Chip:柔和小徽章(状态/类别/计数) ----------
// tipMode: 'css' 用 data-tip(内容区);'native' 用 title(sidebar 等 overflow 容器内)
export function Chip({
  color,
  children,
  tip,
  tipMode = 'css',
  style,
}: {
  color: string;
  children: ReactNode;
  tip?: string;
  tipMode?: 'css' | 'native';
  style?: CSSProperties;
}) {
  return (
    <span
      data-tip={tip && tipMode === 'css' ? tip : undefined}
      title={tip && tipMode === 'native' ? tip : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 8px',
        borderRadius: R.pill,
        fontSize: FS.cap,
        fontWeight: 500,
        background: `${color}1A`,
        color,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ---------- SoftButton:三档按钮 ----------
export function SoftButton({
  variant = 'default',
  disabled,
  onClick,
  children,
  tip,
  tipAlign,
  style,
}: {
  variant?: 'default' | 'primary' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tip?: string;
  tipAlign?: 'start' | 'end';
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    padding: '5px 14px',
    borderRadius: R.md,
    fontSize: FS.sm,
    cursor: disabled ? 'default' : 'pointer',
    border: 'none',
    fontWeight: 500,
    transition: 'box-shadow .15s ease, transform .15s ease, background .15s ease',
    opacity: disabled ? 0.55 : 1,
    ...style,
  };
  const variants: Record<string, CSSProperties> = {
    default: { background: C.card, color: C.text, border: `1px solid ${C.border}` },
    primary: { background: C.link, color: '#fff' },
    ghost: { background: 'transparent', color: C.link },
  };
  return (
    <button
      className="ap-btn"
      data-tip={tip}
      data-tip-align={tipAlign}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

// ---------- Notice:操作反馈条(扫描结果/错误) ----------
export function Notice({
  kind,
  children,
  onClose,
}: {
  kind: 'ok' | 'err' | 'info';
  children: ReactNode;
  onClose?: () => void;
}) {
  const color = kind === 'ok' ? C.cr : kind === 'err' ? C.high : C.link;
  const icon = kind === 'ok' ? '✓' : kind === 'err' ? '✕' : 'ℹ';
  return (
    <div
      className="fade-in"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: SP.sm,
        padding: `${SP.sm}px ${SP.md}px`,
        borderRadius: R.md,
        fontSize: FS.sm,
        background: `${color}14`,
        color: C.text,
        lineHeight: 1.5,
      }}
    >
      <span style={{ color, fontWeight: 600, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
      {onClose && (
        <span
          onClick={onClose}
          style={{ color: C.mute, cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}
        >
          ✕
        </span>
      )}
    </div>
  );
}

// ---------- BarRow:横向比例条(工具频次/分布/成功率) ----------
export function BarRow({
  label,
  ratio,
  color,
  right,
  labelWidth = 140,
  tip,
}: {
  label: ReactNode;
  ratio: number;
  color: string;
  right?: ReactNode;
  labelWidth?: number;
  tip?: string;
}) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SP.sm,
        fontSize: FS.sm,
        padding: '3px 0',
      }}
    >
      <span
        className="clamp1"
        title={typeof label === 'string' ? label : undefined}
        style={{ width: labelWidth, color: C.text, flexShrink: 0 }}
      >
        {label}
      </span>
      <div
        data-tip={tip}
        style={{
          flex: 1,
          height: 10,
          background: C.borderSoft,
          borderRadius: R.pill,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: R.pill,
            minWidth: pct > 0 ? 4 : 0,
            transition: 'width .3s ease',
          }}
        />
      </div>
      {right != null && (
        <span
          className="tnum"
          style={{ textAlign: 'right', color: C.sub, flexShrink: 0, fontSize: FS.cap }}
        >
          {right}
        </span>
      )}
    </div>
  );
}

// ---------- StatCard:KPI 卡(等宽数字 + 解释提示) ----------
export function StatCard({
  value,
  label,
  warn,
  tip,
  tipAlign,
}: {
  value: ReactNode;
  label: string;
  warn?: boolean;
  tip?: string;
  tipAlign?: 'start' | 'end';
}) {
  return (
    <div
      data-tip={tip}
      data-tip-align={tipAlign}
      style={{
        background: C.card,
        borderRadius: R.lg,
        boxShadow: SHADOW.card,
        padding: `${SP.md}px ${SP.lg}px`,
      }}
    >
      <div
        className="tnum"
        style={{
          fontSize: FS.kpi,
          fontWeight: 600,
          color: warn ? C.medium : C.text,
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: FS.cap,
          color: C.sub,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {label}
        {tip && <span style={{ color: C.mute, fontSize: 10, cursor: 'help' }}>ⓘ</span>}
      </div>
    </div>
  );
}

// ---------- TokenStrip:签名元素 —— 4 类 token 构成「指纹条」 ----------
// input/cc/cr/out 比例条,session 行 / 详情页头部共用,全局色彩系统的图例
export function TokenStrip({
  input,
  cc,
  cr,
  out,
  height = 4,
  tipMode = 'css',
}: {
  input: number;
  cc: number;
  cr: number;
  out: number;
  height?: number;
  tipMode?: 'css' | 'native';
}) {
  const total = input + cc + cr + out || 1;
  const segs = [
    { v: input, c: C.input, l: 'input' },
    { v: cc, c: C.cc, l: 'cache_create' },
    { v: cr, c: C.cr, l: 'cache_read' },
    { v: out, c: C.out, l: 'output' },
  ];
  const tip = segs.map((s) => `${s.l} ${((s.v / total) * 100).toFixed(0)}%`).join(' · ');
  return (
    <div
      data-tip={tipMode === 'css' ? tip : undefined}
      title={tipMode === 'native' ? tip : undefined}
      style={{
        display: 'flex',
        height,
        borderRadius: R.pill,
        overflow: 'hidden',
        background: C.borderSoft,
        flex: 1,
        minWidth: 24,
      }}
    >
      {segs.map((s) => (
        <div
          key={s.l}
          style={{ width: `${(s.v / total) * 100}%`, background: s.c, minWidth: s.v > 0 ? 2 : 0 }}
        />
      ))}
    </div>
  );
}

// ---------- Empty:空态(给方向,不给情绪) ----------
export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: `${SP.xl}px 0`, textAlign: 'center' }}>
      <div style={{ fontSize: FS.sm, color: C.sub }}>{text}</div>
      {hint && <div style={{ fontSize: FS.cap, color: C.mute, marginTop: SP.xs }}>{hint}</div>}
    </div>
  );
}

// ---------- SectionTitle:页面级分节标题 ----------
export function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: SP.md,
      }}
    >
      <div style={{ fontSize: FS.title, fontWeight: 600, color: C.text }}>{children}</div>
      {meta != null && (
        <div className="tnum" style={{ fontSize: FS.cap, color: C.mute }}>
          {meta}
        </div>
      )}
    </div>
  );
}

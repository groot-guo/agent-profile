import { C, FS, R, SP } from '../../theme';

export type SessionView = 'overview' | 'context' | 'tools' | 'evidence';

export function SessionViewNav({
  active,
  embedded,
  items,
  onChange,
}: {
  active: SessionView;
  embedded: boolean;
  items: { id: SessionView; label: string; meta: string }[];
  onChange: (view: SessionView) => void;
}) {
  return (
    <div className="session-view-nav" data-embedded={embedded ? 'true' : 'false'}>
      <div className="session-view-nav-label">
        <span>分析视图</span>
        <span className="tnum">04</span>
      </div>
      <div className="session-view-tabs" role="tablist" aria-label="Session 分析视图">
        {items.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              id={`session-view-${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="session-view-panel"
              className="session-view-tab"
              data-active={selected ? 'true' : 'false'}
              onClick={() => onChange(item.id)}
            >
              <span>{item.label}</span>
              <span className="tnum">{item.meta}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ViewIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="session-view-intro">
      <div>{eyebrow}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: SP.sm,
        padding: '2px 0',
        fontSize: FS.sm,
      }}
    >
      <span className="clamp1" title={k} style={{ color: C.text, minWidth: 0 }}>
        {k}
      </span>
      <span className="tnum" style={{ color: C.sub, flexShrink: 0 }}>
        {v}
      </span>
    </div>
  );
}

export function ExportLink({
  href,
  label,
  color = C.link,
}: {
  href: string;
  label: string;
  color?: string;
}) {
  return (
    <a
      href={href}
      download
      className="ap-btn"
      style={{
        color,
        textDecoration: 'none',
        fontSize: FS.cap,
        fontWeight: 500,
        padding: '3px 10px',
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
        background: C.card,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'box-shadow .15s ease, transform .15s ease',
      }}
    >
      ⬇ {label}
    </a>
  );
}

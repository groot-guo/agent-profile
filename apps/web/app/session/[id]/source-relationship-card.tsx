import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { C, FS, R, SP } from '../../theme';
import { Card, Chip } from '../../ui';
import { relationshipStatusLabel, shortSessionId } from './source-relationship';

export interface SessionRelationshipReport {
  parent: { id: string; availability: 'available' | 'unavailable'; sourceKind: string } | null;
  children: Array<{ id: string; sourceKind: string }>;
  coverage: {
    status: 'linked' | 'parent_unavailable' | 'not_captured';
    supportedSources: ['codex'];
  };
}

type Props = {
  relationships: SessionRelationshipReport;
  embedded?: boolean;
  onNavigate?: (id: string) => void;
};

export function SourceRelationshipCard({ relationships, embedded = false, onNavigate }: Props) {
  const status = relationshipStatusLabel(relationships.coverage.status);
  return (
    <Card title="来源会话关系" meta={status}>
      <div style={{ display: 'grid', gap: SP.sm, color: C.sub, fontSize: FS.sm, lineHeight: 1.6 }}>
        <span>
          仅展示来源明确提供的 Session 关系；当前支持 Codex rollout 的
          `parent_thread_id`，不从标题、路径、时间或模型推断。
        </span>
        {relationships.parent ? (
          <RelationshipParent
            parent={relationships.parent}
            embedded={embedded}
            onNavigate={onNavigate}
          />
        ) : (
          <span>父会话：来源未采集稳定关系。</span>
        )}
        {relationships.children.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center' }}>
            <span>子会话：</span>
            {relationships.children.map((child) => (
              <RelationshipLink
                key={child.id}
                id={child.id}
                embedded={embedded}
                onNavigate={onNavigate}
              >
                {shortSessionId(child.id)}
              </RelationshipLink>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function RelationshipParent({
  parent,
  embedded,
  onNavigate,
}: {
  parent: NonNullable<SessionRelationshipReport['parent']>;
  embedded: boolean;
  onNavigate?: (id: string) => void;
}) {
  if (parent.availability === 'unavailable') {
    return (
      <span>
        父会话：<code>{shortSessionId(parent.id)}</code>（来源已提供 ID，但该父会话尚未导入）
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center' }}>
      <span>父会话：</span>
      <RelationshipLink id={parent.id} embedded={embedded} onNavigate={onNavigate}>
        {shortSessionId(parent.id)}
      </RelationshipLink>
      <Chip color={C.mute}>{parent.sourceKind}</Chip>
    </div>
  );
}

function RelationshipLink({
  id,
  embedded,
  onNavigate,
  children,
}: {
  id: string;
  embedded: boolean;
  onNavigate?: (id: string) => void;
  children: string;
}) {
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      !embedded ||
      !onNavigate ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onNavigate(id);
  };

  return (
    <Link
      href={`/session/${encodeURIComponent(id)}`}
      onClick={handleClick}
      style={relationshipLinkStyle}
    >
      {children}
    </Link>
  );
}

const relationshipLinkStyle = {
  border: `1px solid ${C.border}`,
  borderRadius: R.md,
  color: C.link,
  padding: '2px 8px',
  textDecoration: 'none',
} as const;

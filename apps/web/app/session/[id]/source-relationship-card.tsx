import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { C, FS, fmtTime, R, SP } from '../../theme';
import { Card, Chip } from '../../ui';
import {
  callbackStatusLabel,
  relationshipDisplayName,
  relationshipStatusLabel,
  type SourceCallbackStatus,
  shortSessionId,
} from './source-relationship';

export interface SessionRelationshipReport {
  parent: RelationshipNode | null;
  children: RelationshipNode[];
  coverage: {
    status: 'linked' | 'parent_unavailable' | 'not_captured';
    supportedSources: ['codex'];
  };
}

interface RelationshipNode {
  id: string;
  sourceKind: string;
  availability?: 'available' | 'unavailable';
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  callStartedAt?: number;
  callbackAt?: number;
  callbackStatus?: SourceCallbackStatus;
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
          仅展示来源明确提供的 Session 关系；当前支持 Codex rollout 的 state/rollout lineage
          字段，不从标题、路径、时间或模型推断。
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
              <div key={child.id} style={{ display: 'flex', flexWrap: 'wrap', gap: SP.xs }}>
                <RelationshipLink id={child.id} embedded={embedded} onNavigate={onNavigate}>
                  {relationshipDisplayName(child)}
                </RelationshipLink>
                <RelationshipEvidence node={child} />
              </div>
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
      <div style={{ display: 'grid', gap: SP.xs }}>
        <span>
          父会话：<code>{shortSessionId(parent.id)}</code>（来源已提供 ID，但该父会话尚未导入）
          {relationshipDisplayName(parent) !== shortSessionId(parent.id) && (
            <span style={{ color: C.text }}> · {relationshipDisplayName(parent)}</span>
          )}
        </span>
        <RelationshipEvidence node={parent} />
      </div>
    );
  }
  const displayName = relationshipDisplayName(parent);
  return (
    <div style={{ display: 'grid', gap: SP.xs }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center' }}>
        <span>父会话：</span>
        <RelationshipLink id={parent.id} embedded={embedded} onNavigate={onNavigate}>
          {shortSessionId(parent.id)}
        </RelationshipLink>
        <Chip color={C.mute}>{parent.sourceKind}</Chip>
        {displayName !== shortSessionId(parent.id) && (
          <span style={{ color: C.text }}>{displayName}</span>
        )}
      </div>
      <RelationshipEvidence node={parent} />
    </div>
  );
}

function RelationshipEvidence({ node }: { node: RelationshipNode }) {
  const details: string[] = [];
  if (node.callStartedAt !== undefined) details.push(`调用 ${fmtTime(node.callStartedAt)}`);
  if (node.callbackAt !== undefined) details.push(`回调 ${fmtTime(node.callbackAt)}`);
  if (node.callbackStatus) details.push(callbackStatusLabel(node.callbackStatus));
  if (details.length === 0) return null;
  return <span style={{ color: C.mute, fontSize: FS.cap }}>{details.join(' · ')}</span>;
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

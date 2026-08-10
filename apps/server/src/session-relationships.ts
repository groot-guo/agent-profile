import type { DatabaseConnection } from './database';

type ParentAvailability = 'available' | 'unavailable';
type CallbackStatus = 'observed' | 'final_answer';

interface RelationshipEvidence {
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  callStartedAt?: number;
  callbackAt?: number;
  callbackStatus?: CallbackStatus;
}

export interface SessionRelationshipReport {
  parent:
    | ({
        id: string;
        availability: ParentAvailability;
        sourceKind: string;
      } & RelationshipEvidence)
    | null;
  children: Array<{ id: string; sourceKind: string } & RelationshipEvidence>;
  coverage: {
    status: 'linked' | 'parent_unavailable' | 'not_captured';
    supportedSources: ['codex'];
  };
}

export function loadSessionRelationships(
  database: DatabaseConnection,
  sessionId: string,
): SessionRelationshipReport {
  const parent = database
    .prepare(
      `SELECT relationship.parent_session_id as id, relationship.source_kind as sourceKind,
              CASE WHEN session.id IS NULL THEN 'unavailable' ELSE 'available' END as availability,
              relationship.agent_nickname as agentNickname,
              relationship.agent_role as agentRole,
              relationship.agent_path as agentPath,
              relationship.call_started_at as callStartedAt,
              relationship.callback_at as callbackAt,
              relationship.callback_status as callbackStatus
       FROM session_relationships relationship
       LEFT JOIN sessions session ON session.id = relationship.parent_session_id
       WHERE relationship.child_session_id = ?`,
    )
    .get(sessionId) as
    | ({
        id: string;
        sourceKind: string;
        availability: ParentAvailability;
      } & RelationshipEvidence)
    | undefined;
  const children = database
    .prepare(
      `SELECT child_session_id as id, source_kind as sourceKind,
              agent_nickname as agentNickname,
              agent_role as agentRole,
              agent_path as agentPath,
              call_started_at as callStartedAt,
              callback_at as callbackAt,
              callback_status as callbackStatus
       FROM session_relationships WHERE parent_session_id = ?
       ORDER BY child_session_id`,
    )
    .all(sessionId) as Array<{ id: string; sourceKind: string } & RelationshipEvidence>;
  return {
    parent: parent ? normalizeRelationship(parent) : null,
    children: children.map(normalizeRelationship),
    coverage: {
      status:
        parent === undefined
          ? 'not_captured'
          : parent.availability === 'available'
            ? 'linked'
            : 'parent_unavailable',
      supportedSources: ['codex'],
    },
  };
}

function normalizeRelationship<T extends RelationshipEvidence>(relationship: T): T {
  return Object.fromEntries(
    Object.entries(relationship).filter(([, value]) => value !== null && value !== undefined),
  ) as T;
}

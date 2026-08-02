import type { DatabaseConnection } from './database';

type ParentAvailability = 'available' | 'unavailable';

export interface SessionRelationshipReport {
  parent: { id: string; availability: ParentAvailability; sourceKind: string } | null;
  children: Array<{ id: string; sourceKind: string }>;
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
              CASE WHEN session.id IS NULL THEN 'unavailable' ELSE 'available' END as availability
       FROM session_relationships relationship
       LEFT JOIN sessions session ON session.id = relationship.parent_session_id
       WHERE relationship.child_session_id = ?`,
    )
    .get(sessionId) as
    | { id: string; sourceKind: string; availability: ParentAvailability }
    | undefined;
  const children = database
    .prepare(
      `SELECT child_session_id as id, source_kind as sourceKind
       FROM session_relationships WHERE parent_session_id = ?
       ORDER BY child_session_id`,
    )
    .all(sessionId) as Array<{ id: string; sourceKind: string }>;
  return {
    parent: parent ?? null,
    children,
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

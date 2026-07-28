/**
 * Primary Session surfaces count source records that contain main-chain
 * evidence. Codex Desktop persists guardian rollouts as separate child records;
 * those records remain directly addressable, but must not be counted as peer
 * top-level Sessions.
 */
export function primarySessionPredicate(alias: 'sessions' | 's' = 'sessions'): string {
  return `(
    COALESCE(${alias}.agent, '') <> 'codex'
    OR EXISTS (
      SELECT 1
      FROM spans primary_span
      WHERE primary_span.session_id = ${alias}.id
        AND primary_span.is_sidechain = 0
    )
  )`;
}

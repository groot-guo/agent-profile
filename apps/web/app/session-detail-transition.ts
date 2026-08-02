export const SESSION_DETAIL_STATUS_TYPE = 'agent-profile:session-detail-status';

export type SessionDetailStatus = 'ready' | 'error';

export interface SessionDetailStatusMessage {
  type: typeof SESSION_DETAIL_STATUS_TYPE;
  id: string;
  status: SessionDetailStatus;
}

export function parseSessionDetailStatus(value: unknown): SessionDetailStatusMessage | null {
  if (!isRecord(value)) return null;
  if (value.type !== SESSION_DETAIL_STATUS_TYPE) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (value.status !== 'ready' && value.status !== 'error') return null;
  return { type: SESSION_DETAIL_STATUS_TYPE, id: value.id, status: value.status };
}

export function isCurrentSessionDetailStatus(
  status: SessionDetailStatusMessage | null,
  id: string | null,
): boolean {
  return status?.id === id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

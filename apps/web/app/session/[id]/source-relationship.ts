export type SourceRelationshipCoverage = 'linked' | 'parent_unavailable' | 'not_captured';

export type SourceCallbackStatus = 'observed' | 'final_answer';

export function relationshipStatusLabel(status: SourceRelationshipCoverage): string {
  if (status === 'linked') return '关系已关联';
  if (status === 'parent_unavailable') return '父会话未导入';
  return '未采集';
}

export function callbackStatusLabel(status: SourceCallbackStatus): string {
  return status === 'final_answer' ? '已收到最终答复' : '已观察到回调';
}

export function shortSessionId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 20)}…` : id;
}

export function relationshipDisplayName(relationship: {
  id: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
}): string {
  return (
    relationship.agentNickname?.trim() ||
    relationship.agentRole?.trim() ||
    relationship.agentPath?.trim() ||
    shortSessionId(relationship.id)
  );
}

export type SourceRelationshipCoverage = 'linked' | 'parent_unavailable' | 'not_captured';

export function relationshipStatusLabel(status: SourceRelationshipCoverage): string {
  if (status === 'linked') return '关系已关联';
  if (status === 'parent_unavailable') return '父会话未导入';
  return '未采集';
}

export function shortSessionId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 20)}…` : id;
}

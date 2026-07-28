import { sessionRecordsProjectAgent } from '@agent-profile/core/project';
import { AGENT_LABELS } from './theme';

export function projectLabel(project: string): string {
  const sessionRecordsAgent = sessionRecordsProjectAgent(project);
  if (sessionRecordsAgent) {
    const agent = AGENT_LABELS[sessionRecordsAgent] || sessionRecordsAgent;
    return sessionRecordsAgent === 'unknown' ? '会话记录' : `${agent} 会话记录`;
  }
  if (project === '/') return '系统根目录';
  const normalized = project.replace(/\/+$/, '');
  return normalized.split('/').pop() || project;
}

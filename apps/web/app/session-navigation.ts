import type { SessionDiscoveryPage } from '@agent-profile/contracts';
import type { SessionSummary } from '@agent-profile/core';
import { classifySessionProject, isSessionRecordsProject } from '@agent-profile/core/project';
import { projectLabel } from './project-label';
import { AGENT_LABELS } from './theme';

export type SessionSort = 'time' | 'cost' | 'tokens' | 'cache' | 'duration';
export type SessionQuickView = 'all' | 'anomaly' | 'unpriced';
export type SessionTimeRange = 'all' | '1d' | '7d' | '30d' | '90d';
export type ProjectPickerGroup = 'records' | 'recent' | 'other';

const SORT_GROUP_LABELS: Record<Exclude<SessionSort, 'time'>, string> = {
  cost: '成本最高',
  tokens: 'Token 最多',
  cache: 'Cache 最低',
  duration: '耗时最长',
};

export interface ProjectPickerOption {
  project: string;
  name: string;
  parentPath: string;
  count: number;
  lastUsedAt: number;
  group: ProjectPickerGroup;
}

export interface SessionNavigationState {
  agent: string;
  project: string;
  query: string;
  timeRange: SessionTimeRange;
  sort: SessionSort;
  quickView: SessionQuickView;
  selectedId: string | null;
}

export const DEFAULT_SESSION_NAVIGATION: SessionNavigationState = {
  agent: 'all',
  project: '',
  query: '',
  timeRange: 'all',
  sort: 'time',
  quickView: 'all',
  selectedId: null,
};

type SessionLocation = Pick<SessionSummary, 'agent'> &
  Partial<Pick<SessionSummary, 'cwd' | 'filePath'>> & { project?: string };

export function sessionProject(session: SessionLocation): string {
  if (typeof session.project === 'string' && session.project) return session.project;
  return classifySessionProject(session);
}

export function sessionDisplayTitle(
  session: Pick<SessionSummary, 'agent' | 'startTime'> &
    Partial<Pick<SessionSummary, 'name' | 'cwd' | 'filePath'>> & { project?: string },
): string {
  const sourceTitle = session.name?.trim();
  if (sourceTitle) return sourceTitle;
  const agent = AGENT_LABELS[session.agent] || session.agent || 'Agent';
  const projectKey = sessionProject(session);
  const project = projectLabel(projectKey);
  if (isSessionRecordsProject(projectKey))
    return `${project} · ${formatLocalStart(session.startTime)}`;
  return `${agent} · ${project} · ${formatLocalStart(session.startTime)}`;
}

export function filterSessions(
  sessions: SessionSummary[],
  anomalyIds: Set<string>,
  state: SessionNavigationState,
  now = Date.now(),
): SessionSummary[] {
  const query = state.query.trim().toLowerCase();
  const cutoff = timeRangeCutoff(state.timeRange, now);
  return sessions
    .filter((session) => state.agent === 'all' || session.agent === state.agent)
    .filter((session) => !state.project || sessionProject(session) === state.project)
    .filter((session) => cutoff === null || session.startTime >= cutoff)
    .filter((session) => {
      if (!query) return true;
      const project = sessionProject(session);
      return (
        sessionDisplayTitle(session).toLowerCase().includes(query) ||
        project.toLowerCase().includes(query) ||
        projectLabel(project).toLowerCase().includes(query) ||
        session.id.toLowerCase().includes(query)
      );
    })
    .filter((session) => {
      if (state.quickView === 'anomaly') return anomalyIds.has(session.id);
      if (state.quickView === 'unpriced') return session.costUnknownCount > 0;
      return true;
    })
    .sort((a, b) => compareSessions(a, b, state.sort));
}

export function projectOptions(
  sessions: SessionSummary[],
): Array<{ project: string; count: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const project = sessionProject(session);
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));
}

export function projectPickerOptions(
  sessions: SessionSummary[],
  recentLimit = 6,
): ProjectPickerOption[] {
  const projects = new Map<string, { count: number; lastUsedAt: number }>();
  for (const session of sessions) {
    const project = sessionProject(session);
    const current = projects.get(project);
    if (current) {
      current.count += 1;
      current.lastUsedAt = Math.max(current.lastUsedAt, session.startTime);
    } else {
      projects.set(project, { count: 1, lastUsedAt: session.startTime });
    }
  }

  const records: ProjectPickerOption[] = [];
  const filesystem: ProjectPickerOption[] = [];
  for (const [project, summary] of projects) {
    const option = {
      project,
      name: projectLabel(project),
      parentPath: projectParentPath(project),
      count: summary.count,
      lastUsedAt: summary.lastUsedAt,
      group: 'other' as ProjectPickerGroup,
    };
    if (isSessionRecordsProject(project)) {
      records.push({ ...option, parentPath: '', group: 'records' });
    } else {
      filesystem.push(option);
    }
  }

  records.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.count - a.count);
  filesystem.sort(
    (a, b) =>
      b.lastUsedAt - a.lastUsedAt || b.count - a.count || a.project.localeCompare(b.project),
  );
  return [
    ...records,
    ...filesystem.map<ProjectPickerOption>((option, index) => ({
      ...option,
      group: index < Math.max(0, recentLimit) ? 'recent' : 'other',
    })),
  ];
}

export function projectPickerOptionsFromFacets(
  facets: SessionDiscoveryPage['facets']['projects'],
  recentLimit = 6,
): ProjectPickerOption[] {
  const records: ProjectPickerOption[] = [];
  const filesystem: ProjectPickerOption[] = [];
  for (const facet of facets) {
    const option = {
      project: facet.project,
      name: projectLabel(facet.project),
      parentPath: projectParentPath(facet.project),
      count: facet.count,
      lastUsedAt: facet.lastUsedAt,
      group: 'other' as ProjectPickerGroup,
    };
    if (isSessionRecordsProject(facet.project)) {
      records.push({ ...option, parentPath: '', group: 'records' });
    } else {
      filesystem.push(option);
    }
  }
  records.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.count - a.count);
  filesystem.sort(
    (a, b) =>
      b.lastUsedAt - a.lastUsedAt || b.count - a.count || a.project.localeCompare(b.project),
  );
  return [
    ...records,
    ...filesystem.map<ProjectPickerOption>((option, index) => ({
      ...option,
      group: index < Math.max(0, recentLimit) ? 'recent' : 'other',
    })),
  ];
}

export function filterProjectPickerOptions(
  options: ProjectPickerOption[],
  query: string,
): ProjectPickerOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;
  return options.filter((option) =>
    `${option.name}\n${option.parentPath}${option.group === 'records' ? '' : `\n${option.project}`}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

export function groupSessionsByTime<T extends Pick<SessionSummary, 'startTime'>>(
  sessions: T[],
  now = Date.now(),
): Array<{ key: string; label: string; sessions: T[] }> {
  const groups = new Map<string, { label: string; sessions: T[] }>();
  for (const session of sessions) {
    const boundary = timeBoundary(session.startTime, now);
    const group = groups.get(boundary.key);
    if (group) group.sessions.push(session);
    else groups.set(boundary.key, { label: boundary.label, sessions: [session] });
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

export function groupSessionsForDisplay<T extends Pick<SessionSummary, 'startTime'>>(
  sessions: T[],
  sort: SessionSort,
  now = Date.now(),
): Array<{ key: string; label: string; sessions: T[] }> {
  if (sort === 'time') return groupSessionsByTime(sessions, now);
  return [{ key: `sort-${sort}`, label: SORT_GROUP_LABELS[sort], sessions }];
}

export function parseSessionNavigation(search: string): SessionNavigationState {
  const params = new URLSearchParams(search);
  const sort = params.get('sort');
  const quickView = params.get('view');
  const timeRange = params.get('range');
  return {
    agent: params.get('agent') || 'all',
    project: params.get('project') || '',
    query: params.get('q') || '',
    timeRange: isTimeRange(timeRange) ? timeRange : 'all',
    sort: isSessionSort(sort) ? sort : 'time',
    quickView: isQuickView(quickView) ? quickView : 'all',
    selectedId: params.get('session'),
  };
}

export function serializeSessionNavigation(state: SessionNavigationState): string {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.project) params.set('project', state.project);
  if (state.agent !== 'all') params.set('agent', state.agent);
  if (state.timeRange !== 'all') params.set('range', state.timeRange);
  if (state.sort !== 'time') params.set('sort', state.sort);
  if (state.quickView !== 'all') params.set('view', state.quickView);
  if (state.selectedId) params.set('session', state.selectedId);
  return params.toString();
}

export function visibleSessionSlice(sessions: SessionSummary[], limit: number): SessionSummary[] {
  return sessions.slice(0, Math.max(0, limit));
}

function compareSessions(a: SessionSummary, b: SessionSummary, sort: SessionSort): number {
  if (sort === 'cost') return b.totalCost - a.totalCost;
  if (sort === 'tokens') return totalTokens(b) - totalTokens(a);
  if (sort === 'cache') return a.cacheHitRate - b.cacheHitRate;
  if (sort === 'duration') {
    return (b.endTime || 0) - b.startTime - ((a.endTime || 0) - a.startTime);
  }
  return b.startTime - a.startTime;
}

function totalTokens(session: SessionSummary): number {
  return (
    session.inputTokens +
    session.cacheCreationTokens +
    session.cacheReadTokens +
    session.outputTokens
  );
}

function timeBoundary(timestamp: number, now: number): { key: string; label: string } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sessionDay = new Date(timestamp);
  sessionDay.setHours(0, 0, 0, 0);
  const daysAgo = Math.floor((today.getTime() - sessionDay.getTime()) / 86_400_000);
  if (daysAgo <= 0) return { key: 'today', label: '今天' };
  if (daysAgo === 1) return { key: 'yesterday', label: '昨天' };
  if (daysAgo <= 7) return { key: 'last-7-days', label: '最近 7 天' };
  if (daysAgo <= 30) return { key: 'last-30-days', label: '最近 30 天' };
  return { key: 'earlier', label: '更早' };
}

function isSessionSort(value: string | null): value is SessionSort {
  return ['time', 'cost', 'tokens', 'cache', 'duration'].includes(value ?? '');
}

function isQuickView(value: string | null): value is SessionQuickView {
  return ['all', 'anomaly', 'unpriced'].includes(value ?? '');
}

function isTimeRange(value: string | null): value is SessionTimeRange {
  return ['all', '1d', '7d', '30d', '90d'].includes(value ?? '');
}

function timeRangeCutoff(range: SessionTimeRange, now: number): number | null {
  if (range === 'all') return null;
  return now - Number.parseInt(range, 10) * 86_400_000;
}

function formatLocalStart(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return '时间未知';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function projectParentPath(project: string): string {
  if (isSessionRecordsProject(project) || project === '/') return '';
  const normalized = project.replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) return '';
  return normalized.slice(0, separator) || '/';
}

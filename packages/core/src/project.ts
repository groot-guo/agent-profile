const SESSION_RECORDS_PROJECT_PREFIX = 'agent-profile:session-records:';

export const CODEX_SESSION_RECORDS_PROJECT = `${SESSION_RECORDS_PROJECT_PREFIX}codex`;

export interface SessionProjectInput {
  agent?: string | null;
  cwd?: string | null;
  filePath?: string | null;
}

/**
 * Resolve the analytical project bucket without treating an arbitrary source
 * storage folder as project evidence.
 */
export function classifySessionProject(session: SessionProjectInput): string {
  if (session.agent === 'codex' && isCodexManagedDatedWorkspace(session.cwd)) {
    return CODEX_SESSION_RECORDS_PROJECT;
  }
  if (typeof session.cwd === 'string' && session.cwd.trim()) return session.cwd;

  const claudeProject =
    session.agent === 'claude-code' ? claudeProjectFromTranscriptPath(session.filePath) : undefined;
  if (claudeProject) return claudeProject;

  const agent =
    typeof session.agent === 'string' && session.agent.trim() ? session.agent : 'unknown';
  return `${SESSION_RECORDS_PROJECT_PREFIX}${encodeURIComponent(agent)}`;
}

export function sessionRecordsProjectAgent(project: string): string | undefined {
  if (!project.startsWith(SESSION_RECORDS_PROJECT_PREFIX)) return undefined;
  const encoded = project.slice(SESSION_RECORDS_PROJECT_PREFIX.length);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export function isSessionRecordsProject(project: string): boolean {
  return sessionRecordsProjectAgent(project) !== undefined;
}

function claudeProjectFromTranscriptPath(filePath?: string | null): string | undefined {
  if (!filePath) return undefined;
  const parts = filePath.split(/[\\/]+/);
  const claudeIndex = parts.lastIndexOf('.claude');
  if (claudeIndex < 0 || parts[claudeIndex + 1] !== 'projects') return undefined;
  const encoded = parts[claudeIndex + 2];
  if (!encoded) return undefined;
  return encoded.startsWith('-') ? `/${encoded.slice(1).replace(/-/g, '/')}` : encoded;
}

function isCodexManagedDatedWorkspace(cwd?: string | null): boolean {
  if (!cwd) return false;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.some(
    (part, index) =>
      part === 'Documents' &&
      parts[index + 1] === 'Codex' &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[index + 2] ?? '') &&
      Boolean(parts[index + 3]),
  );
}

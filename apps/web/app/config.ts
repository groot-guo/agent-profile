export const API = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api';

export const TRANSCRIPT_SCAN_SOURCES = [
  { agent: 'claude-code', label: 'Claude Code', dir: '~/.claude/projects' },
  { agent: 'codex', label: 'Codex', dir: '~/.codex/sessions' },
] as const;

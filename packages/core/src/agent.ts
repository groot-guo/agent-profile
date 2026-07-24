import { homedir } from 'node:os';
import { join } from 'node:path';

// 根据文件路径推断 agent 类型
export function detectAgent(filePath: string): string {
  const home = homedir();
  if (filePath.startsWith(join(home, '.claude', 'projects'))) return 'claude-code';
  if (filePath.startsWith(join(home, '.codex'))) return 'codex';
  return 'unknown';
}

// Agent 显示标签
export const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  zed: 'Zed',
  unknown: 'Unknown',
};

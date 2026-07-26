import { homedir } from 'node:os';
import { join } from 'node:path';

// Agent 类型定义
export const AGENT_TYPES = [
  'claude-code',
  'codex',
  'kimi-code',
  'mimo-code',
  'opencode',
  'zed',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number] | 'unknown';

// Agent 显示标签
export const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'kimi-code': 'Kimi Code',
  'mimo-code': 'MiMo Code',
  opencode: 'Open Code',
  copilot: 'Copilot',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini CLI',
  zcode: 'ZCode',
  zed: 'Zed',
};

// 根据文件路径推断 agent 类型
export function detectAgent(filePath: string): string {
  const home = homedir();
  if (filePath.startsWith(join(home, '.claude', 'projects'))) return 'claude-code';
  if (filePath.startsWith(join(home, '.codex'))) return 'codex';
  if (filePath.startsWith(join(home, '.kimi-code')) || filePath.startsWith(join(home, '.kimi')))
    return 'kimi-code';
  if (filePath.startsWith(join(home, '.local', 'share', 'opencode'))) return 'opencode';
  // MiMo: SQLite DB 路径通过特殊前缀识别，JSONL 扫描不适用
  if (filePath.startsWith('mimo://')) return 'mimo-code';
  // 其他常见 agent（目录待验证）
  if (filePath.includes(join(home, '.cursor'))) return 'cursor';
  if (filePath.includes(join(home, '.windsurf'))) return 'windsurf';
  if (filePath.includes(join(home, '.gemini')) || filePath.includes('gemini-cli'))
    return 'gemini-cli';
  return 'unknown';
}

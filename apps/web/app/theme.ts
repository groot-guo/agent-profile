// 明亮主题配色（全站统一）
export const C = {
  bg: '#f6f8fa',
  card: '#ffffff',
  border: '#d0d7de',
  borderSoft: '#eaeef2',
  text: '#1f2328',
  sub: '#656d76',
  mute: '#8c959f',
  link: '#0969da',
  input: '#0969da',
  cc: '#8250df',
  cr: '#1a7f37',
  out: '#bc4c00',
  high: '#cf222e',
  medium: '#9a6700',
  low: '#8c959f',
  axis: '#d0d7de',
  grid: '#eaeef2',
} as const;

// 工具类别映射
export const TOOL_CAT: Record<string, string> = {
  Read: '文件操作',
  Write: '文件操作',
  Edit: '文件操作',
  Grep: '文件操作',
  Glob: '文件操作',
  Bash: '命令执行',
  WebFetch: '网络',
  WebSearch: '网络',
  AskUserQuestion: '用户交互',
  Workflow: '编排',
  Task: '编排',
  ToolSearch: '元工具',
  TodoWrite: '元工具',
};

export const DIAG_LABEL: Record<string, string> = {
  repeated_read: '重复读取',
  large_output: '大输出携带',
  low_cache: 'cache 命中低',
  context_bloat: '上下文堆积',
  long_thinking: 'thinking 过长',
  repeated_failure: '重复试错',
  read_scope_too_large: '读取范围过大',
  thinking_detour: 'thinking 偏离',
  ineffective_exploration: '无效探索',
  tool_off_target: '工具偏离',
};

export const SEV_COLOR: Record<string, string> = { high: C.high, medium: C.medium, low: C.low };

export const CAT_COLOR: Record<string, string> = {
  文件操作: '#fb8f1e',
  命令执行: '#d4a72c',
  网络: '#bf8700',
  用户交互: '#218bff',
  MCP: '#bc4c00',
  编排: '#d1572a',
  元工具: '#8c959f',
  其他: '#6e7681',
};

export function catOf(name: string) {
  return name.startsWith('mcp__') ? 'MCP' : TOOL_CAT[name] || '其他';
}

// Agent 类型
export const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  zed: 'Zed',
  unknown: 'Unknown',
};

export const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#0969da',
  codex: '#8250df',
  zed: '#1a7f37',
  unknown: '#656d76',
};

// 文字 fallback（SVG 图标优先，见 icons.tsx）
export const AGENT_ICONS: Record<string, string> = {
  'claude-code': 'C',
  codex: 'X',
  zed: 'Z',
  unknown: '?',
};

// 格式化工具函数
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function fmtDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)}MB`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)}KB`;
  return `${b}B`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
}

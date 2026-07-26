// ============================================================
// Agent Profile 设计 token —— 全局唯一视觉规范来源
// 色值走 CSS 变量(明暗双主题见 layout.tsx);尺寸/字号/圆角/阴影为常量
// 规范文档:docs/ui-guidelines.md
// ============================================================

// ---------- 颜色(引用 CSS 变量,fallback 为 light 值) ----------
export const C = {
  bg: 'var(--c-bg, #F5F3F0)',
  card: 'var(--c-card, #FEFDFC)',
  border: 'var(--c-border, #E6E1DA)',
  borderSoft: 'var(--c-borderSoft, #EFEBE5)',
  text: 'var(--c-text, #2E2C28)',
  sub: 'var(--c-sub, #6F6A61)',
  mute: 'var(--c-mute, #9C958B)',
  link: 'var(--c-link, #5F6FC0)',
  input: 'var(--c-input, #6E7FC7)',
  cc: 'var(--c-cc, #9A7FC8)',
  cr: 'var(--c-cr, #6FA58A)',
  out: 'var(--c-out, #C08356)',
  high: 'var(--c-high, #C65D4E)',
  medium: 'var(--c-medium, #B08A2E)',
  low: 'var(--c-low, #9C958B)',
  axis: 'var(--c-axis, #DDD7CE)',
  grid: 'var(--c-grid, #EFEBE5)',
} as const;

// ---------- 尺寸 / 圆角 / 字号 / 阴影 ----------
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const R = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
export const FS = { cap: 11, sm: 12, base: 13, title: 14, page: 18, kpi: 20 } as const;
export const SHADOW = {
  card: 'var(--shadow-card, 0 1px 2px rgba(80,66,45,.05), 0 6px 20px rgba(80,66,45,.05))',
  lift: 'var(--shadow-lift, 0 2px 4px rgba(80,66,45,.07), 0 10px 28px rgba(80,66,45,.09))',
} as const;

// ---------- 工具类别映射 ----------
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
  same_param_loop: '同参数循环',
  write_then_read: '写后立即读',
  context_compression: '上下文压缩',
  model_downgrade: '模型降级',
  thinking_detour: 'thinking 偏离',
  ineffective_exploration: '无效探索',
  tool_off_target: '工具偏离',
};

export const SEV_COLOR: Record<string, string> = { high: C.high, medium: C.medium, low: C.low };
export const SEV_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

// ---------- 类别 / Agent 配色(柔化,主要用于低透明度 chip 底 + 文字) ----------
export const CAT_COLOR: Record<string, string> = {
  文件操作: '#D98E4A',
  命令执行: '#C2A44A',
  网络: '#B8933D',
  用户交互: '#6FA3D9',
  MCP: '#C97F52',
  编排: '#CE7350',
  元工具: '#98A0A9',
  其他: '#8E959D',
};

export function catOf(name: string) {
  return name.startsWith('mcp__') ? 'MCP' : TOOL_CAT[name] || '其他';
}

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
  unknown: 'Unknown',
};

export const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#5F85E0',
  codex: '#9A7BD8',
  'kimi-code': '#9B83F0',
  'mimo-code': '#EF9148',
  opencode: '#3FBF9B',
  copilot: '#5BC99A',
  cursor: '#8589F0',
  windsurf: '#4FB8CE',
  'gemini-cli': '#6B9BF0',
  zcode: '#DFAE57',
  zed: '#5CA96B',
  unknown: '#8A9199',
};

// 文字 fallback(SVG 图标优先,见 icons.tsx)
export const AGENT_ICONS: Record<string, string> = {
  'claude-code': 'C',
  codex: 'X',
  'kimi-code': 'K',
  'mimo-code': 'M',
  opencode: 'O',
  zed: 'Z',
  unknown: '?',
};

// ---------- 格式化 ----------
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

// 相对时间:刚刚 / n分钟前 / n小时前 / n天前 / 超 30 天回退到日期
export function fmtAgo(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

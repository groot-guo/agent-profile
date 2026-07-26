// ===== transcript 原始结构（NDJSON 每行一个事件） =====

export type TranscriptType =
  | 'assistant'
  | 'user'
  | 'system'
  | 'ai-title'
  | 'attachment'
  | 'file-history-delta'
  | 'file-history-snapshot'
  | 'last-prompt'
  | 'mode'
  | 'permission-mode'
  | 'queue-operation'
  | string;

// assistant message 的 usage（四类 token + server 工具）
export interface TranscriptUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

// content block 三种
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}
export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string; // 配对 tool_result 的 key
  name: string;
  input: unknown;
}
export type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

// tool_result block（出现在 user message content 数组里）
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface TranscriptMessage {
  role: 'assistant' | 'user';
  content: string | ContentBlock[] | ToolResultBlock[];
  model?: string;
  usage?: TranscriptUsage;
  stop_reason?: string | null;
}

// transcript 一行
export interface TranscriptEntry {
  uuid: string;
  parentUuid?: string | null;
  timestamp: string; // ISO8601
  sessionId?: string;
  session_id?: string;
  isSidechain?: boolean;
  type: TranscriptType;
  message?: TranscriptMessage;
  toolUseResult?: unknown;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  effort?: string;
  aiTitle?: string; // type='ai-title' 行携带
}

// ===== 分析后结构 =====

export type SpanType = 'llm_turn' | 'tool_call' | 'thinking' | 'answer';

export interface Span {
  id: string; // transcript uuid
  sessionId: string;
  parentId?: string | null; // parentUuid
  type: SpanType;
  name: string;
  startTime: number; // ms epoch
  endTime?: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextTokens: number; // llm_turn: input+cc+cr（该轮上下文大小）
  outputBytes: number; // tool_call: result 字节数
  model?: string;
  cost: number;
  costUnknown: boolean; // 模型无定价
  stopReason?: string | null;
  isError: boolean;
  isSidechain: boolean;
  metadata?: Record<string, unknown>;
}

// parser 输出（解析后、分析前）
export interface ParsedMeta {
  name?: string;
  filePath: string;
  startTime: number;
  endTime?: number;
  cwd?: string;
  gitBranch?: string;
  claudeVersion?: string;
  messageCount: number;
  agent: string;
}

export interface ParsedSession {
  sessionId: string;
  meta: ParsedMeta;
  spans: Span[];
}

export interface SessionSummary {
  id: string;
  name?: string;
  filePath: string;
  agent: string;
  startTime: number;
  endTime?: number;
  cwd?: string;
  gitBranch?: string;
  claudeVersion?: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCost: number;
  costUnknownCount: number;
  peakContextTokens: number;
  avgContextTokens: number;
  cacheHitRate: number;
  fileMtime?: number;
  fileSize?: number;
  fileLines?: number;
  messageCount: number;
  importedAt: number;
}

export interface SessionDetail extends SessionSummary {
  spans: Span[];
}

// ===== pricing =====
export interface Pricing {
  model: string;
  inputPrice: number; // USD / 1M tokens
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  effectiveFrom?: number;
}

// ===== scan 结果 =====
export interface ScanResult {
  scanned: number;
  imported: number;
  skipped: number;
  updated: number;
  sessionIds: string[];
}

// ===== 效率指标 =====

export interface ToolSuccessRate {
  name: string;
  category: string;
  total: number;
  errors: number;
  successRate: number;
}

export interface ThinkingActionRatio {
  turnIndex: number;
  turnId: string;
  thinkingChars: number;
  toolCalls: number;
  ratio: number; // chars per tool_call, 0 if no tool calls
}

export interface FileOperation {
  path: string;
  reads: number;
  edits: number;
  writes: number;
}

export interface EfficiencyMetrics {
  toolSuccessRates: ToolSuccessRate[];
  thinkingActionRatios: ThinkingActionRatio[];
  contextGrowthVelocity: number; // avg tokens/turn
  contextGrowthPerTurn: { turnIndex: number; turnId: string; contextTokens: number; delta: number }[];
  fileOperations: FileOperation[];
  readToEditRate: number; // files edited / files read
}

// ===== 成本归因 =====

export interface CostByCategory {
  category: string;
  cost: number;
  turnCount: number;
  toolCount: number;
  percentage: number;
}

export interface CostByPhase {
  phase: string;
  turnCount: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

export interface CostAttribution {
  totalCost: number;
  costByCategory: CostByCategory[];
  costByPhase: CostByPhase[];
  wastedCostRatio: number; // diagnosis wastedCost / totalCost
}

// ===== 性能指标 =====

export interface LatencyStats {
  avg: number;
  median: number;
  p95: number;
  max: number;
}

export interface ToolLatency {
  name: string;
  count: number;
  avg: number;
  median: number;
  p95: number;
  max: number;
}

export interface TurnPerformance {
  turnIndex: number;
  turnId: string;
  duration: number;
  isSlow: boolean; // > 2x P95
}

export interface PerformanceMetrics {
  turnLatency: LatencyStats;
  toolLatency: LatencyStats;
  toolLatencyByName: ToolLatency[];
  slowTurns: TurnPerformance[];
  throughput: number; // tokens/min
  sessionDuration: number; // ms
}

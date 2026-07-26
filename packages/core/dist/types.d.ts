export type TranscriptType = 'assistant' | 'user' | 'system' | 'ai-title' | 'attachment' | 'file-history-delta' | 'file-history-snapshot' | 'last-prompt' | 'mode' | 'permission-mode' | 'queue-operation' | string;
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
    id: string;
    name: string;
    input: unknown;
}
export type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;
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
export interface TranscriptEntry {
    uuid: string;
    parentUuid?: string | null;
    timestamp: string;
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
    aiTitle?: string;
}
export type SpanType = 'llm_turn' | 'tool_call' | 'thinking' | 'answer';
export interface Span {
    id: string;
    sessionId: string;
    parentId?: string | null;
    type: SpanType;
    name: string;
    startTime: number;
    endTime?: number;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    contextTokens: number;
    outputBytes: number;
    model?: string;
    cost: number;
    costUnknown: boolean;
    stopReason?: string | null;
    isError: boolean;
    isSidechain: boolean;
    metadata?: Record<string, unknown>;
}
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
export interface Pricing {
    model: string;
    inputPrice: number;
    cacheCreationPrice: number;
    cacheReadPrice: number;
    outputPrice: number;
    effectiveFrom?: number;
}
export interface ScanResult {
    scanned: number;
    imported: number;
    skipped: number;
    updated: number;
    sessionIds: string[];
}
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
    ratio: number;
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
    contextGrowthVelocity: number;
    contextGrowthPerTurn: {
        turnIndex: number;
        turnId: string;
        contextTokens: number;
        delta: number;
    }[];
    fileOperations: FileOperation[];
    readToEditRate: number;
}
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
    wastedCostRatio: number;
}
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
    isSlow: boolean;
}
export interface PerformanceMetrics {
    turnLatency: LatencyStats;
    toolLatency: LatencyStats;
    toolLatencyByName: ToolLatency[];
    slowTurns: TurnPerformance[];
    throughput: number;
    sessionDuration: number;
}
//# sourceMappingURL=types.d.ts.map
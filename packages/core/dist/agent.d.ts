export declare const AGENT_TYPES: readonly ["claude-code", "codex", "kimi-code", "mimo-code", "opencode", "zed"];
export type AgentType = (typeof AGENT_TYPES)[number] | 'unknown';
export declare const AGENT_LABELS: Record<string, string>;
export declare function detectAgent(filePath: string): string;
//# sourceMappingURL=agent.d.ts.map
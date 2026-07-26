import type { Pricing, SessionDetail } from './types';
export type DiagnosisType = 'repeated_read' | 'large_output' | 'low_cache' | 'context_bloat' | 'long_thinking' | 'repeated_failure' | 'read_scope_too_large' | 'same_param_loop' | 'write_then_read' | 'context_compression' | 'model_downgrade' | 'thinking_detour' | 'ineffective_exploration' | 'tool_off_target';
export type Severity = 'high' | 'medium' | 'low';
export interface DiagnosisFinding {
    type: DiagnosisType;
    severity: Severity;
    title: string;
    detail: string;
    wastedTokens: number;
    wastedCost: number;
    costUnknown: boolean;
    suggestion: string;
    spanIds: string[];
}
export interface DiagnosisResult {
    findings: DiagnosisFinding[];
    totalWastedTokens: number;
    totalWastedCost: number;
    costUnknownCount: number;
}
export interface DiagnosisThresholds {
    repeatedReadMin: number;
    largeOutputBytes: number;
    largeOutputMinAfterTurns: number;
    lowCacheRate: number;
    lowCacheMinInput: number;
    contextBloatUtilization: number;
    contextBloatMinPeak: number;
    longThinkingChars: number;
    repeatedFailureMin: number;
    bytesPerToken: number;
    readScopeBytes: number;
    sameParamLoopMin: number;
    writeThenReadMaxGap: number;
    contextCompressionRatio: number;
    modelDowngradeCostRatio: number;
}
export declare const DEFAULT_THRESHOLDS: DiagnosisThresholds;
export interface DiagnoseOptions {
    pricingLookup?: (model?: string) => Pricing | undefined;
    contextWindowLookup?: (model?: string) => number | undefined;
    thresholds?: Partial<DiagnosisThresholds>;
    llmDiagnoser?: LlmDiagnoser;
}
export interface LlmDiagnoseContext {
    sessionId: string;
    taskTitle?: string;
    thinkingTexts: {
        spanId: string;
        text: string;
    }[];
    toolCallSequence: {
        spanId: string;
        name: string;
        input: string;
        isError: boolean;
    }[];
}
export interface LlmFinding {
    type: 'thinking_detour' | 'ineffective_exploration' | 'tool_off_target';
    severity: Severity;
    title: string;
    detail: string;
    suggestion: string;
    spanIds: string[];
}
export interface LlmDiagnoser {
    diagnose(ctx: LlmDiagnoseContext): Promise<LlmFinding[]>;
}
export declare function diagnoseSession(detail: SessionDetail, options?: DiagnoseOptions): Promise<DiagnosisResult>;
export declare function diagnoseSessionSync(detail: SessionDetail, options?: DiagnoseOptions): DiagnosisResult;
//# sourceMappingURL=diagnosis.d.ts.map
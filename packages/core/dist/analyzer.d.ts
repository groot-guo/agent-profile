import type { CostAttribution, EfficiencyMetrics, ParsedSession, PerformanceMetrics, Pricing, SessionSummary, Span } from './types';
export interface FileMeta {
    mtime: number;
    size: number;
    lines: number;
}
export declare function analyzeSession(parsed: ParsedSession, pricingLookup: (model?: string) => Pricing | undefined, fileMeta?: FileMeta, importedAt?: number): {
    summary: SessionSummary;
    spans: Span[];
};
export declare function analyzeEfficiency(spans: Span[]): EfficiencyMetrics;
export interface EfficiencyScore {
    score: number;
    tokenEfficiency: number;
    cacheUtilization: number;
    toolSuccess: number;
    wasteAvoidance: number;
    percentile?: number;
}
export declare function calcEfficiencyScore(efficiency: EfficiencyMetrics, cacheHitRate: number, totalTokens: number, outputTokens: number, totalCost: number, wastedCost?: number): EfficiencyScore;
export declare function analyzeCostAttribution(spans: Span[], wastedCost?: number): CostAttribution;
export declare function analyzePerformance(spans: Span[]): PerformanceMetrics;
export interface ToolParamAnalysis {
    bashCategories: {
        category: string;
        count: number;
    }[];
    readParamStats: {
        withLimit: number;
        withoutLimit: number;
        avgLimit?: number;
    };
    frequentPairs: {
        pair: string;
        count: number;
    }[];
}
export declare function analyzeToolParams(spans: Span[]): ToolParamAnalysis;
//# sourceMappingURL=analyzer.d.ts.map
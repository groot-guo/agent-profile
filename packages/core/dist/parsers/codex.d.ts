import type { ParsedSession } from '../types';
interface CodexEntry {
    timestamp: string;
    type: string;
    payload: Record<string, unknown>;
}
export interface CodexParseOptions {
    filePath: string;
}
export declare function parseCodexTranscript(entries: CodexEntry[], opts: CodexParseOptions): ParsedSession | null;
export {};
//# sourceMappingURL=codex.d.ts.map
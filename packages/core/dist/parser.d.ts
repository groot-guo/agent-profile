import type { ParsedSession, TranscriptEntry } from './types';
export interface ParseOptions {
    filePath: string;
    agent?: string;
}
export declare function parseTranscript(entries: TranscriptEntry[], opts: ParseOptions): ParsedSession | null;
//# sourceMappingURL=parser.d.ts.map
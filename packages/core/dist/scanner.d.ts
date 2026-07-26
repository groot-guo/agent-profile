import type { TranscriptEntry } from './types';
export declare function findTranscriptFiles(root: string): Promise<string[]>;
export declare function readTranscript(filePath: string): Promise<TranscriptEntry[]>;
export declare function findTranscriptFilesSync(root: string): string[];
export declare function readTranscriptSync(filePath: string): TranscriptEntry[];
//# sourceMappingURL=scanner.d.ts.map
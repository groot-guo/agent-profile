import type { ParsedSession } from './types';
export interface ZedThreadInput {
    id: string;
    summary: string;
    folderPaths: string | null;
    updatedAt: string;
    createdAt: string | null;
    dataType: string;
    dataBuffer: Buffer;
}
export declare function parseZedThread(input: ZedThreadInput): Promise<ParsedSession | null>;
//# sourceMappingURL=zed-parser.d.ts.map
import type { ParsedSession } from '../types';
interface MiMoMessage {
    id: string;
    data: {
        role: string;
        modelID?: string;
        providerID?: string;
        tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache?: {
                read: number;
                write: number;
            };
        };
        cost?: number;
        time?: {
            created: number;
            completed?: number;
        };
        parentID?: string;
        path?: {
            cwd: string;
            root: string;
        };
    };
    parts: MiMoPart[];
    agent_id: string;
}
interface MiMoPart {
    id: string;
    data: {
        type: string;
        text?: string;
        callID?: string;
        tool?: string;
        state?: {
            status: string;
            input?: Record<string, unknown>;
            output?: unknown;
        };
    };
}
interface MiMoSessionMeta {
    id: string;
    title: string;
    directory: string;
    time_created: number;
    time_updated: number;
}
export declare function parseMiMoSession(sessionMeta: MiMoSessionMeta, messages: MiMoMessage[]): ParsedSession | null;
export {};
//# sourceMappingURL=mimo.d.ts.map
const METADATA_LIMIT = 10_000;
function truncate(s) {
    if (s.length <= METADATA_LIMIT)
        return s;
    return `${s.slice(0, METADATA_LIMIT)}…[truncated ${s.length - METADATA_LIMIT} chars]`;
}
function safeStringify(v) {
    if (v == null)
        return '';
    if (typeof v === 'string')
        return v;
    try {
        return truncate(JSON.stringify(v));
    }
    catch {
        return String(v);
    }
}
function toMs(iso) {
    return new Date(iso).getTime();
}
function makeSpan(p) {
    return {
        id: p.id, sessionId: p.sessionId, parentId: p.parentId ?? null,
        type: p.type, name: p.name, startTime: p.startTime, endTime: p.endTime,
        inputTokens: p.inputTokens || 0, cacheCreationTokens: 0, cacheReadTokens: 0,
        outputTokens: p.outputTokens || 0,
        contextTokens: 0, outputBytes: p.outputBytes || 0, model: p.model,
        cost: 0, costUnknown: false, isError: !!p.isError, isSidechain: !!p.isSidechain,
        metadata: p.metadata,
    };
}
// 解析 Zed thread 的 data BLOB → ParsedSession
// 格式：NDJSON，每行是 TranscriptEntry（兼容 Claude Code transcript 格式）
export async function parseZedThread(input) {
    const entries = [];
    const raw = input.dataBuffer.toString('utf8');
    // 尝试按 NDJSON 解析
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const obj = JSON.parse(t);
            if (obj && typeof obj === 'object' && 'type' in obj) {
                entries.push(obj);
            }
        }
        catch {
            // 跳过坏行
        }
    }
    if (entries.length === 0) {
        // 非 NDJSON 数据：创建基本 session（无 spans）
        return createBasicSession(input);
    }
    // 尝试复用 Claude Code parser（NDJSON 格式）
    try {
        // parseTranscript 在同一 package 内，直接引用
        const { parseTranscript } = await import('./parser.js');
        const parsed = parseTranscript(entries, {
            filePath: `zed://threads/${input.id}`,
            agent: 'zed',
        });
        if (parsed) {
            parsed.meta.name = input.summary || parsed.meta.name;
            parsed.meta.cwd = extractFirstFolder(input.folderPaths) || parsed.meta.cwd;
            return parsed;
        }
    }
    catch {
        // fall through to basic
    }
    return createBasicSession(input);
}
function extractFirstFolder(folderPaths) {
    if (!folderPaths)
        return undefined;
    try {
        const arr = JSON.parse(folderPaths);
        return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : undefined;
    }
    catch {
        return undefined;
    }
}
function createBasicSession(input) {
    const startTime = input.createdAt ? toMs(input.createdAt) : toMs(input.updatedAt);
    const endTime = toMs(input.updatedAt);
    // 尝试从 summary 中提取有意义的行作为 span
    const spans = [];
    const lines = input.summary.split('\n').filter(Boolean);
    if (lines.length > 0) {
        spans.push(makeSpan({
            id: `${input.id}-summary`,
            sessionId: input.id,
            type: 'answer',
            name: 'summary',
            startTime,
            endTime,
            outputTokens: Math.round(input.summary.length / 4),
            metadata: { text: truncate(input.summary) },
        }));
    }
    return {
        sessionId: input.id,
        meta: {
            name: lines[0]?.slice(0, 80) || input.id.slice(0, 8),
            filePath: `zed://threads/${input.id}`,
            startTime,
            endTime,
            cwd: extractFirstFolder(input.folderPaths),
            messageCount: 0,
            agent: 'zed',
        },
        spans,
    };
}
//# sourceMappingURL=zed-parser.js.map
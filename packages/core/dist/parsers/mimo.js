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
function makeSpan(p) {
    return {
        id: p.id, sessionId: p.sessionId, parentId: p.parentId ?? null,
        type: p.type, name: p.name, startTime: p.startTime, endTime: p.endTime,
        inputTokens: p.inputTokens || 0, cacheCreationTokens: p.cacheCreationTokens || 0,
        cacheReadTokens: p.cacheReadTokens || 0, outputTokens: p.outputTokens || 0,
        contextTokens: 0, outputBytes: p.outputBytes || 0, model: p.model,
        cost: 0, costUnknown: false, isError: !!p.isError, isSidechain: !!p.isSidechain,
        metadata: p.metadata,
    };
}
// 解析 MiMo Code 数据库中的 session → ParsedSession
export function parseMiMoSession(sessionMeta, messages) {
    if (messages.length === 0)
        return null;
    const spans = [];
    const sid = sessionMeta.id;
    const cwd = sessionMeta.directory;
    const modelProvider = messages.find((m) => m.data.providerID)?.data.providerID;
    // 按时间排序
    const sorted = [...messages].sort((a, b) => (a.data.time?.created || 0) - (b.data.time?.created || 0));
    // 提取 session 名称：优先短标题，长系统指令 → 用首条 reasoning 摘要
    let name;
    if (sessionMeta.title.length <= 200) {
        name = sessionMeta.title;
    }
    else {
        // 尝试从首条 assistant reasoning 提取摘要
        for (const msg of sorted) {
            if (msg.data.role !== 'assistant')
                continue;
            for (const part of msg.parts || []) {
                if (part.data.type === 'reasoning' && part.data.text) {
                    const firstLine = part.data.text.split('\n')[0].replace(/^\*+/, '').replace(/\*+$/, '').trim();
                    name = firstLine.slice(0, 80) || sessionMeta.title.slice(0, 80);
                    break;
                }
            }
            if (name)
                break;
        }
        if (!name)
            name = sessionMeta.title.slice(0, 80) + '…';
    }
    // 构建 callID → tool output 映射
    const toolOutputs = new Map();
    for (const msg of sorted) {
        const parts = msg.parts || [];
        for (const part of parts) {
            if (part.data.type === 'tool' && part.data.callID) {
                const state = part.data.state;
                if (state?.output !== undefined) {
                    toolOutputs.set(part.data.callID, { output: state.output, status: state.status });
                }
            }
        }
    }
    for (const msg of sorted) {
        const d = msg.data;
        if (d.role !== 'assistant')
            continue;
        const turnId = msg.id;
        const turnStart = d.time?.created || sessionMeta.time_created;
        const turnEnd = d.time?.completed;
        const tokens = d.tokens;
        const inputTokens = tokens?.input || 0;
        const cacheCreationTokens = tokens?.cache?.write || 0;
        const cacheReadTokens = tokens?.cache?.read || 0;
        const outputTokens = (tokens?.output || 0) + (tokens?.reasoning || 0);
        // llm_turn span
        spans.push(makeSpan({
            id: turnId,
            sessionId: sid,
            parentId: d.parentID || null,
            type: 'llm_turn',
            name: d.modelID || modelProvider || 'mimo',
            startTime: turnStart,
            endTime: turnEnd,
            inputTokens,
            cacheCreationTokens,
            cacheReadTokens,
            outputTokens,
            model: d.modelID,
        }));
        // parts → sub-spans
        const msgParts = msg.parts || [];
        for (const part of msgParts) {
            const pd = part.data;
            if (pd.type === 'reasoning' && pd.text) {
                spans.push(makeSpan({
                    id: `${turnId}-reasoning-${part.id}`,
                    sessionId: sid,
                    parentId: turnId,
                    type: 'thinking',
                    name: 'reasoning',
                    startTime: turnStart,
                    endTime: turnEnd,
                    metadata: { thinking: truncate(pd.text) },
                }));
            }
            else if (pd.type === 'tool' && pd.callID) {
                const result = toolOutputs.get(pd.callID);
                const outputRaw = result?.output;
                const outputBytes = outputRaw != null ? Buffer.byteLength(safeStringify(outputRaw), 'utf8') : 0;
                spans.push(makeSpan({
                    id: pd.callID,
                    sessionId: sid,
                    parentId: turnId,
                    type: 'tool_call',
                    name: pd.tool || 'unknown',
                    startTime: turnStart,
                    endTime: turnEnd,
                    isError: result?.status === 'error',
                    outputBytes,
                    metadata: {
                        input: pd.state?.input ? truncate(safeStringify(pd.state.input)) : undefined,
                        output: outputRaw != null ? truncate(safeStringify(outputRaw)) : undefined,
                    },
                }));
            }
        }
    }
    return {
        sessionId: sid,
        meta: {
            name,
            filePath: `mimo://sessions/${sid}`,
            startTime: sessionMeta.time_created,
            endTime: sessionMeta.time_updated,
            cwd,
            messageCount: sorted.filter((m) => m.data.role === 'assistant').length,
            agent: 'mimo-code',
        },
        spans,
    };
}
//# sourceMappingURL=mimo.js.map
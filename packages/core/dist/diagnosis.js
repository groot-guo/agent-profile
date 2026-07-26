export const DEFAULT_THRESHOLDS = {
    repeatedReadMin: 2,
    largeOutputBytes: 10_000,
    largeOutputMinAfterTurns: 1,
    lowCacheRate: 0.5,
    lowCacheMinInput: 10_000,
    contextBloatUtilization: 0.7,
    contextBloatMinPeak: 100_000,
    longThinkingChars: 4_000,
    repeatedFailureMin: 2,
    bytesPerToken: 4,
    readScopeBytes: 20_000,
    sameParamLoopMin: 3,
    writeThenReadMaxGap: 3,
    contextCompressionRatio: 0.5,
    modelDowngradeCostRatio: 0.5,
};
export async function diagnoseSession(detail, options = {}) {
    const result = diagnoseSessionSync(detail, options);
    // P2.19 LLM 语义诊断（注入 llmDiagnoser 才跑；定性结果 wastedTokens=0，靠 severity 排序）
    if (options.llmDiagnoser) {
        const thinkings = detail.spans.filter((s) => s.type === 'thinking');
        const tools = detail.spans.filter((s) => s.type === 'tool_call');
        const ctx = {
            sessionId: detail.id,
            taskTitle: detail.name,
            thinkingTexts: thinkings
                .filter((th) => typeof th.metadata?.thinking === 'string')
                .map((th) => ({ spanId: th.id, text: th.metadata?.thinking })),
            toolCallSequence: tools.map((tool) => ({
                spanId: tool.id,
                name: tool.name,
                input: typeof tool.metadata?.input === 'string' ? tool.metadata.input : '',
                isError: tool.isError,
            })),
        };
        const llmFindings = await options.llmDiagnoser.diagnose(ctx);
        for (const lf of llmFindings) {
            result.findings.push({ ...lf, wastedTokens: 0, wastedCost: 0, costUnknown: false });
        }
        // 重新排序
        const sevRank = { high: 0, medium: 1, low: 2 };
        result.findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.wastedTokens - a.wastedTokens);
    }
    return result;
}
// 同步版本：仅跑 7 条启发式规则，不含 LLM 诊断
export function diagnoseSessionSync(detail, options = {}) {
    const t = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    const pricingLookup = options.pricingLookup ?? (() => undefined);
    const ctxWindowLookup = options.contextWindowLookup ?? (() => undefined);
    const turns = detail.spans
        .filter((s) => s.type === 'llm_turn')
        .sort((a, b) => a.startTime - b.startTime);
    const tools = detail.spans
        .filter((s) => s.type === 'tool_call')
        .sort((a, b) => a.startTime - b.startTime);
    const thinkings = detail.spans.filter((s) => s.type === 'thinking');
    const mainModel = turns.find((turn) => turn.model)?.model;
    const mainPricing = pricingLookup(mainModel);
    // token→cost：按关联模型 input_price 估算（cache 实际更便宜，故为上限）
    const costOfTokens = (tokens, model) => {
        const p = pricingLookup(model) ?? mainPricing;
        if (!p)
            return { cost: 0, unknown: true };
        return { cost: (tokens * p.inputPrice) / 1e6, unknown: false };
    };
    const findings = [
        ...detectRepeatedRead(tools, t, costOfTokens),
        ...detectLargeOutput(turns, tools, t, costOfTokens),
        ...detectLowCache(detail, turns, t, costOfTokens),
        ...detectContextBloat(detail, turns, t, ctxWindowLookup, costOfTokens),
        ...detectLongThinking(thinkings, t, costOfTokens),
        ...detectRepeatedFailure(tools, turns, t, costOfTokens),
        ...detectReadScope(tools, t, costOfTokens),
        ...detectSameParamLoop(tools, t, costOfTokens),
        ...detectWriteThenRead(tools, t, costOfTokens),
        ...detectContextCompression(turns, t, costOfTokens),
        ...detectModelDowngrade(turns, t, costOfTokens, pricingLookup),
    ];
    // 排序：severity 优先（high>medium>low），同 severity 内 wastedTokens 降序
    const sevRank = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.wastedTokens - a.wastedTokens);
    return {
        findings,
        totalWastedTokens: findings.reduce((s, f) => s + f.wastedTokens, 0),
        totalWastedCost: findings.reduce((s, f) => s + f.wastedCost, 0),
        costUnknownCount: findings.filter((f) => f.costUnknown).length,
    };
}
// ===== 1. 重复读取 =====
// Claude Code Read 的 input 是 { file_path, offset?, limit? }，parser 存为 JSON 字符串
const READ_TOOLS = new Set(['Read', 'read_file']);
function extractFilePath(tool) {
    const input = tool.metadata?.input;
    if (typeof input !== 'string')
        return undefined;
    try {
        const obj = JSON.parse(input);
        if (typeof obj.file_path === 'string')
            return obj.file_path;
    }
    catch {
        /* input 可能被截断成非法 JSON，跳过 */
    }
    return undefined;
}
// Read 的 offset/limit（判断是否整文件读）
function extractReadLimit(tool) {
    const input = tool.metadata?.input;
    if (typeof input !== 'string')
        return undefined;
    try {
        const obj = JSON.parse(input);
        return typeof obj.limit === 'number' ? { limit: obj.limit } : {};
    }
    catch {
        return undefined;
    }
}
// ===== P2.18 Read 范围过大（启发式） =====
// 整文件读（无 limit）且输出大 → 建议用 offset/limit 收窄
function detectReadScope(tools, t, costOfTokens) {
    const findings = [];
    for (const tool of tools) {
        if (!READ_TOOLS.has(tool.name))
            continue;
        if (tool.outputBytes < t.readScopeBytes)
            continue;
        const lim = extractReadLimit(tool);
        if (lim?.limit != null)
            continue; // 有 limit 不算整文件读（limit=0 也是显式设置）
        const path = extractFilePath(tool);
        const estTok = estTokens(tool.outputBytes, t);
        const wastedTokens = Math.round(estTok * 0.5); // 假设只需读一半
        const { cost, unknown } = costOfTokens(wastedTokens, tool.model);
        findings.push({
            type: 'read_scope_too_large',
            severity: sevByTokens(wastedTokens, 5_000, 1_000),
            title: `${tool.name} 整文件读取 ${fmtBytes(tool.outputBytes)}`,
            detail: `${path ? shortPath(path) : '?'} 整文件读取 ${fmtBytes(tool.outputBytes)}（约 ${fmtTok(estTok)} token），未用 limit 收窄，预计只需一半`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '用 offset/limit 只读需要的片段，或先 Grep 定位再 Read 关键区域',
            spanIds: [tool.id],
        });
    }
    return findings;
}
function detectRepeatedRead(tools, t, costOfTokens) {
    const byPath = new Map();
    for (const r of tools) {
        if (!READ_TOOLS.has(r.name))
            continue;
        const p = extractFilePath(r);
        if (!p)
            continue;
        const arr = byPath.get(p);
        if (arr)
            arr.push(r);
        else
            byPath.set(p, [r]);
    }
    const findings = [];
    for (const [path, rs] of byPath) {
        if (rs.length < t.repeatedReadMin)
            continue;
        const wastedTokens = rs.slice(1).reduce((s, r) => s + estTokens(r.outputBytes, t), 0);
        if (wastedTokens === 0)
            continue;
        const { cost, unknown } = costOfTokens(wastedTokens, rs[0].model);
        findings.push({
            type: 'repeated_read',
            severity: sevByTokens(wastedTokens, 10_000, 2_000),
            title: `${rs[0].name} 重复读取 ${rs.length} 次：${shortPath(path)}`,
            detail: `${shortPath(path)} 被读取 ${rs.length} 次，后 ${rs.length - 1} 次输出约 ${fmtTok(wastedTokens)} token 可复用首次结果避免`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '保留首次读取结果在上下文中复用；若只需变更部分，用 offset/limit 只读相关区域',
            spanIds: rs.map((r) => r.id),
        });
    }
    return findings;
}
// ===== 2. 大输出持续携带 =====
function detectLargeOutput(turns, tools, t, costOfTokens) {
    const findings = [];
    for (const tool of tools) {
        if (tool.outputBytes < t.largeOutputBytes)
            continue;
        const afterTurns = turns.filter((turn) => turn.startTime > tool.startTime);
        if (afterTurns.length < t.largeOutputMinAfterTurns)
            continue;
        const estTok = estTokens(tool.outputBytes, t);
        // ×后续轮数是理论上限：实际可能因上下文压缩低于此值，但占用的上下文空间是真实的
        const wastedTokens = estTok * afterTurns.length;
        const { cost, unknown } = costOfTokens(wastedTokens, tool.model);
        findings.push({
            type: 'large_output',
            severity: sevByTokens(wastedTokens, 500_000, 50_000),
            title: `${tool.name} 大输出被后续 ${afterTurns.length} 轮持续携带`,
            detail: `${tool.name} 输出 ${fmtBytes(tool.outputBytes)}（约 ${fmtTok(estTok)} token），在后续 ${afterTurns.length} 轮上下文中重复携带，累计理论上限约 ${fmtTok(wastedTokens)} token（实际可能因上下文压缩更低）`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '大输出读取后及时清理或用 head/grep 收窄到关键片段，避免长输出长期占用上下文',
            spanIds: [tool.id],
        });
    }
    return findings;
}
// ===== 3. cache 命中率低 =====
function detectLowCache(detail, turns, t, costOfTokens) {
    const totalInput = detail.inputTokens + detail.cacheCreationTokens + detail.cacheReadTokens;
    if (totalInput < t.lowCacheMinInput)
        return [];
    if (detail.cacheHitRate >= t.lowCacheRate)
        return [];
    const nonCached = detail.inputTokens + detail.cacheCreationTokens;
    const { cost, unknown } = costOfTokens(nonCached);
    return [
        {
            type: 'low_cache',
            severity: detail.cacheHitRate < 0.3 ? 'high' : 'medium',
            title: `cache 命中率低（${(detail.cacheHitRate * 100).toFixed(0)}%）`,
            detail: `总输入 ${fmtTok(totalInput)} 中仅 ${(detail.cacheHitRate * 100).toFixed(0)}% 命中 cache，未命中部分 ${fmtTok(nonCached)}（input+cache_creation）按 input 价计费，本可走更便宜的 cache_read`,
            wastedTokens: nonCached,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '检查是否有频繁切换对话或长间隔导致 cache 失效；保持请求模式稳定以提升 cache 命中',
            spanIds: turns.map((turn) => turn.id),
        },
    ];
}
// ===== 4. 上下文堆积 =====
function detectContextBloat(detail, turns, t, ctxWindowLookup, costOfTokens) {
    if (turns.length === 0)
        return [];
    const peak = detail.peakContextTokens;
    const windowModel = turns.find((turn) => turn.model && ctxWindowLookup(turn.model))?.model;
    const window = windowModel ? ctxWindowLookup(windowModel) : undefined;
    const utilization = window ? peak / window : undefined;
    const bloatByUtil = utilization != null && utilization > t.contextBloatUtilization;
    const bloatBySize = peak >= t.contextBloatMinPeak;
    if (!bloatByUtil && !bloatBySize)
        return [];
    // 粗估：峰值上下文中约 40% 为可压缩的历史累积（工具输出/thinking/早期对话）
    const wastedTokens = Math.round(peak * 0.4);
    const { cost, unknown } = costOfTokens(wastedTokens, windowModel);
    const utilTxt = utilization != null ? `，窗口利用率 ${(utilization * 100).toFixed(0)}%` : '';
    return [
        {
            type: 'context_bloat',
            severity: utilization != null
                ? utilization > 0.85
                    ? 'high'
                    : 'medium'
                : peak > 200_000
                    ? 'high'
                    : 'medium',
            title: `上下文堆积（峰值 ${fmtTok(peak)}${utilTxt}）`,
            detail: `峰值上下文达 ${fmtTok(peak)}${window ? ` / 窗口 ${fmtTok(window)}` : ''}${utilTxt}，其中约 ${fmtTok(wastedTokens)} token 为可压缩的历史累积`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '对早期工具输出与已解决的中问步骤做摘要/清理；长会话考虑分段或主动压缩历史',
            spanIds: turns.slice(-3).map((turn) => turn.id),
        },
    ];
}
// ===== 5. 过长 thinking =====
// 长 session 可能有大量过长 thinking，逐条列出会淹没重点：取 top N 单独报，其余聚合成一条
const LONG_THINKING_TOP = 5;
function detectLongThinking(thinkings, t, costOfTokens) {
    const longs = [];
    for (const th of thinkings) {
        const text = th.metadata?.thinking;
        if (typeof text !== 'string')
            continue;
        // parser 对超 10KB 的 thinking 做了截断，text.length 是下限
        if (text.length < t.longThinkingChars)
            continue;
        const estTok = Math.round(text.length / t.bytesPerToken);
        const wastedTokens = Math.round(estTok * 0.5); // 假设可精简一半
        const { cost, unknown } = costOfTokens(wastedTokens, th.model);
        longs.push({ span: th, text, estTok, wastedTokens, cost, unknown });
    }
    if (longs.length === 0)
        return [];
    longs.sort((a, b) => b.wastedTokens - a.wastedTokens);
    const findings = longs.slice(0, LONG_THINKING_TOP).map((l) => ({
        type: 'long_thinking',
        severity: l.estTok > 5_000 ? 'high' : 'medium',
        title: `thinking 过长（≥ ${fmtTok(l.estTok)} token）`,
        detail: `某轮 thinking 至少 ${l.text.length} 字符（约 ${fmtTok(l.estTok)} token），含于该轮 output，精简后预计可省 ${fmtTok(l.wastedTokens)}`,
        wastedTokens: l.wastedTokens,
        wastedCost: l.cost,
        costUnknown: l.unknown,
        suggestion: '检查推理是否绕远路，保留关键决策步骤、删除反复试探的内心独白',
        spanIds: [l.span.id],
    }));
    if (longs.length > LONG_THINKING_TOP) {
        const rest = longs.slice(LONG_THINKING_TOP);
        const restWasted = rest.reduce((s, l) => s + l.wastedTokens, 0);
        const { cost, unknown } = costOfTokens(restWasted, longs[0].span.model);
        findings.push({
            type: 'long_thinking',
            severity: 'medium',
            title: `另有 ${rest.length} 轮 thinking 过长（${fmtTok(rest[rest.length - 1].estTok)}~${fmtTok(rest[0].estTok)} token）`,
            detail: `共 ${rest.length} 轮 thinking 超过 ${t.longThinkingChars} 字符，累计可精简约 ${fmtTok(restWasted)} token`,
            wastedTokens: restWasted,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '批量检查这些轮的推理，精简冗余思考',
            spanIds: rest.map((l) => l.span.id),
        });
    }
    return findings;
}
// ===== 6. 重复试错（同工具连续失败） =====
function detectRepeatedFailure(tools, turns, t, costOfTokens) {
    const byName = new Map();
    for (const tool of tools) {
        const arr = byName.get(tool.name);
        if (arr)
            arr.push(tool);
        else
            byName.set(tool.name, [tool]);
    }
    const findings = [];
    for (const [name, ts] of byName) {
        let runStart = 0, runLen = 0, bestStart = 0, bestLen = 0;
        for (let i = 0; i < ts.length; i++) {
            if (ts[i].isError) {
                if (runLen === 0)
                    runStart = i;
                runLen++;
                if (runLen > bestLen) {
                    bestLen = runLen;
                    bestStart = runStart;
                }
            }
            else {
                runLen = 0;
            }
        }
        if (bestLen < t.repeatedFailureMin)
            continue;
        const run = ts.slice(bestStart, bestStart + bestLen);
        const parentIds = new Set(run.map((r) => r.parentId));
        const parentTurns = turns.filter((turn) => parentIds.has(turn.id));
        const wastedTokens = parentTurns.reduce((s, turn) => s + turn.outputTokens, 0);
        const { cost, unknown } = costOfTokens(wastedTokens, run[0].model);
        findings.push({
            type: 'repeated_failure',
            severity: bestLen >= 4 ? 'high' : 'medium',
            title: `${name} 连续失败 ${bestLen} 次`,
            detail: `${name} 连续失败 ${bestLen} 次后才继续，关联 ${parentTurns.length} 轮推理，消耗约 ${fmtTok(wastedTokens)} output token`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '失败后先读错误输出定位根因再重试，避免盲目改参数；连续失败时停下分析',
            spanIds: run.map((r) => r.id),
        });
    }
    return findings;
}
// ===== 8. 同参数循环 =====
function detectSameParamLoop(tools, t, costOfTokens) {
    const findings = [];
    let runStart = -1, runLen = 0;
    let bestStart = -1, bestLen = 0, bestName = '';
    for (let i = 0; i < tools.length; i++) {
        const prev = i > 0 ? tools[i - 1] : null;
        const curr = tools[i];
        const sameName = prev && curr.name === prev.name;
        const sameInput = prev && JSON.stringify(curr.metadata?.input) === JSON.stringify(prev.metadata?.input);
        if (sameName && sameInput) {
            if (runLen === 0)
                runStart = i - 1;
            runLen++;
            if (runLen > bestLen) {
                bestLen = runLen;
                bestStart = runStart;
                bestName = curr.name;
            }
        }
        else {
            runLen = 0;
        }
    }
    if (bestLen < t.sameParamLoopMin)
        return findings;
    const run = tools.slice(bestStart, bestStart + bestLen + 1);
    const estTok = run.reduce((s, r) => s + estTokens(r.outputBytes || 0, t), 0);
    const wastedTokens = Math.round(estTok * 0.7); // 70% 是浪费
    const { cost, unknown } = costOfTokens(wastedTokens, run[0].model);
    findings.push({
        type: 'same_param_loop',
        severity: bestLen >= 5 ? 'high' : 'medium',
        title: `${bestName} 同参数循环 ${bestLen + 1} 次`,
        detail: `${bestName} 以相同参数连续调用 ${bestLen + 1} 次，输出约 ${fmtTok(estTok)} token，未改变参数说明可能是无效尝试`,
        wastedTokens,
        wastedCost: cost,
        costUnknown: unknown,
        suggestion: '检查 agent 是否误判了工具行为；失败后应改变参数而非重复相同调用',
        spanIds: run.map((r) => r.id),
    });
    return findings;
}
// ===== 9. 写后即读 =====
const WRITE_TOOLS = new Set(['Write', 'Edit', 'write_to_file', 'replace_in_file']);
function detectWriteThenRead(tools, t, costOfTokens) {
    const findings = [];
    const fileOps = [];
    for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        if (WRITE_TOOLS.has(tool.name)) {
            const path = extractFilePath(tool);
            if (path)
                fileOps.push({ idx: i, path, type: 'write' });
        }
        else if (READ_TOOLS.has(tool.name)) {
            const path = extractFilePath(tool);
            if (path)
                fileOps.push({ idx: i, path, type: 'read' });
        }
    }
    const reported = new Set();
    for (let i = 0; i < fileOps.length; i++) {
        if (fileOps[i].type !== 'write')
            continue;
        // Look for a Read of the same file within maxGap operations
        for (let j = i + 1; j < Math.min(fileOps.length, i + 1 + t.writeThenReadMaxGap); j++) {
            if (fileOps[j].type === 'read' && fileOps[j].path === fileOps[i].path) {
                const key = `${fileOps[i].path}-${fileOps[i].idx}`;
                if (reported.has(key))
                    continue;
                reported.add(key);
                const readTool = tools[fileOps[j].idx];
                const estTok = estTokens(readTool.outputBytes || 0, t);
                const wastedTokens = Math.round(estTok * 0.5);
                const { cost, unknown } = costOfTokens(wastedTokens, readTool.model);
                findings.push({
                    type: 'write_then_read',
                    severity: estTok > 3000 ? 'medium' : 'low',
                    title: `Write 后立即 Read: ${shortPath(fileOps[i].path)}`,
                    detail: `${shortPath(fileOps[i].path)} 先被写入，随后在第 ${j - i} 个操作中被读取（${fmtBytes(readTool.outputBytes || 0)}），写入结果已在上下文中无需重新读取`,
                    wastedTokens,
                    wastedCost: cost,
                    costUnknown: unknown,
                    suggestion: '写入后的内容已在上下文中，无需立即 Read 验证；确实验证时可加 limit 收窄',
                    spanIds: [tools[fileOps[i].idx].id, readTool.id],
                });
            }
        }
    }
    return findings;
}
// ===== 10. 上下文压缩检测 =====
function detectContextCompression(turns, t, costOfTokens) {
    const findings = [];
    for (let i = 1; i < turns.length; i++) {
        const prevCtx = turns[i - 1].contextTokens || (turns[i - 1].inputTokens + turns[i - 1].cacheCreationTokens + turns[i - 1].cacheReadTokens);
        const currCtx = turns[i].contextTokens || (turns[i].inputTokens + turns[i].cacheCreationTokens + turns[i].cacheReadTokens);
        if (prevCtx <= 0)
            continue;
        const dropRatio = (prevCtx - currCtx) / prevCtx;
        if (dropRatio < t.contextCompressionRatio)
            continue;
        const dropped = prevCtx - currCtx;
        const wastedTokens = Math.round(dropped * 0.3); // 30% 的压缩内容可能仍需重读
        const { cost, unknown } = costOfTokens(wastedTokens, turns[i].model);
        findings.push({
            type: 'context_compression',
            severity: dropRatio > 0.7 ? 'high' : 'medium',
            title: `上下文压缩: Turn ${i}→${i + 1} 下降 ${(dropRatio * 100).toFixed(0)}%`,
            detail: `上下文从 ${fmtTok(prevCtx)} 骤降至 ${fmtTok(currCtx)}（下降 ${(dropRatio * 100).toFixed(0)}%，约 ${fmtTok(dropped)} token），可能触发了上下文压缩，压缩内容后续可能需重读`,
            wastedTokens,
            wastedCost: cost,
            costUnknown: unknown,
            suggestion: '压缩后确认关键信息仍在上下文中；长会话考虑主动分段以控制上下文大小',
            spanIds: [turns[i - 1].id, turns[i].id],
        });
    }
    return findings;
}
// ===== 11. 模型降级 =====
function detectModelDowngrade(turns, t, costOfTokens, pricingLookup) {
    const findings = [];
    for (let i = 1; i < turns.length; i++) {
        const prevModel = turns[i - 1].model;
        const currModel = turns[i].model;
        if (!prevModel || !currModel || prevModel === currModel)
            continue;
        const prevPricing = pricingLookup(prevModel);
        const currPricing = pricingLookup(currModel);
        if (!prevPricing || !currPricing)
            continue;
        if (currPricing.inputPrice >= prevPricing.inputPrice * t.modelDowngradeCostRatio)
            continue;
        // 模型降级
        findings.push({
            type: 'model_downgrade',
            severity: 'low',
            title: `模型降级: ${prevModel} → ${currModel}`,
            detail: `从 ${prevModel}（input ¥${prevPricing.inputPrice}/1M）切换到 ${currModel}（input ¥${currPricing.inputPrice}/1M），后续 ${turns.length - i} 轮使用低价模型`,
            wastedTokens: 0,
            wastedCost: 0,
            costUnknown: false,
            suggestion: '模型降级为正常 cost 优化手段；确认降级后任务质量无显著下降即可',
            spanIds: [turns[i - 1].id, turns[i].id],
        });
        break; // 只报首次
    }
    return findings;
}
function estTokens(bytes, t) {
    return Math.round(bytes / t.bytesPerToken);
}
function sevByTokens(n, high, medium) {
    if (n > high)
        return 'high';
    if (n > medium)
        return 'medium';
    return 'low';
}
function shortPath(p) {
    const parts = p.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : p;
}
function fmtBytes(b) {
    if (b >= 1_000_000)
        return `${(b / 1_000_000).toFixed(2)}MB`;
    if (b >= 1_000)
        return `${(b / 1_000).toFixed(1)}KB`;
    return `${b}B`;
}
function fmtTok(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}k`;
    return `${n}`;
}
//# sourceMappingURL=diagnosis.js.map
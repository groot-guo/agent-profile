import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
function expandHome(p) {
    if (p === '~' || p.startsWith('~/'))
        return homedir() + p.slice(1);
    return p;
}
// 异步递归扫描目录下所有 *.jsonl（排除 journal.jsonl）
export async function findTranscriptFiles(root) {
    const out = [];
    const dirs = [resolve(expandHome(root))];
    while (dirs.length > 0) {
        const dir = dirs.pop();
        let entries;
        try {
            entries = await readdir(dir);
        }
        catch {
            continue;
        }
        for (const name of entries) {
            const full = join(dir, name);
            let st;
            try {
                st = await stat(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                dirs.push(full);
            }
            else if (name.endsWith('.jsonl') && name !== 'journal.jsonl') {
                out.push(full);
            }
        }
    }
    return out.sort();
}
// 异步读取 transcript NDJSON，逐行解析；跳过坏行，只保留带 type 的事件
export async function readTranscript(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const obj = JSON.parse(t);
            if (obj && typeof obj === 'object' && 'type' in obj) {
                out.push(obj);
            }
        }
        catch {
            /* 跳过坏行 */
        }
    }
    return out;
}
// 保留同步版本供兼容（不推荐新代码使用）
export function findTranscriptFilesSync(root) {
    const out = [];
    walkSync(resolve(expandHome(root)), out);
    return out.sort();
}
function walkSync(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const name of entries) {
        const full = join(dir, name);
        let st;
        try {
            st = statSync(full);
        }
        catch {
            continue;
        }
        if (st.isDirectory()) {
            walkSync(full, out);
        }
        else if (name.endsWith('.jsonl') && name !== 'journal.jsonl') {
            out.push(full);
        }
    }
}
export function readTranscriptSync(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const obj = JSON.parse(t);
            if (obj && typeof obj === 'object' && 'type' in obj) {
                out.push(obj);
            }
        }
        catch {
            /* 跳过坏行 */
        }
    }
    return out;
}
//# sourceMappingURL=scanner.js.map
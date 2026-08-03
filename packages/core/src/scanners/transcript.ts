import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TranscriptEntry } from '../types';

export interface TranscriptTextResult {
  entries: TranscriptEntry[];
  malformedLines: number;
  untypedLines: number;
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

// 异步递归扫描目录下所有 *.jsonl（排除 journal.jsonl）
export async function findTranscriptFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const rootDir = resolve(expandHome(root));
  const dirs = [rootDir];
  const seen = new Set<string>();
  // 根目录也加入 seen，防止子目录中符号链接回根目录导致循环
  try {
    const rootSt = await stat(rootDir);
    if (rootSt.ino != null) seen.add(`${rootSt.dev}:${rootSt.ino}`);
    else seen.add(rootDir);
  } catch {
    /* 根目录不可访问，seen 为空，后续 readdir 也会失败 */
  }

  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (!dir) break;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        const real = st.ino != null ? `${st.dev}:${st.ino}` : full;
        if (!seen.has(real)) {
          seen.add(real);
          dirs.push(full);
        }
      } else if (name.endsWith('.jsonl') && name !== 'journal.jsonl') {
        out.push(full);
      }
    }
  }

  return out.sort();
}

// 异步读取 transcript NDJSON，逐行解析；跳过坏行，只保留带 type 的事件
export async function readTranscript(filePath: string): Promise<TranscriptEntry[]> {
  const raw = await readFile(filePath, 'utf8');
  return parseTranscriptText(raw).entries;
}

export function parseTranscriptText(raw: string): TranscriptTextResult {
  const out: TranscriptEntry[] = [];
  let malformedLines = 0;
  let untypedLines = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object' && 'type' in obj) {
        out.push(obj as TranscriptEntry);
      } else {
        untypedLines++;
      }
    } catch {
      malformedLines++;
    }
  }
  return { entries: out, malformedLines, untypedLines };
}

// 保留同步版本供兼容（不推荐新代码使用）
export function findTranscriptFilesSync(root: string): string[] {
  const out: string[] = [];
  walkSync(resolve(expandHome(root)), out);
  return out.sort();
}

function walkSync(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSync(full, out);
    } else if (name.endsWith('.jsonl') && name !== 'journal.jsonl') {
      out.push(full);
    }
  }
}

export function readTranscriptSync(filePath: string): TranscriptEntry[] {
  const raw = readFileSync(filePath, 'utf8');
  return parseTranscriptText(raw).entries;
}

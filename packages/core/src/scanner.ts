import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptEntry } from './types';

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

// 扫描目录下所有 *.jsonl（递归）
export function findTranscriptFiles(root: string): string[] {
  const out: string[] = [];
  walk(resolve(expandHome(root)), out);
  return out.sort();
}

function walk(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.jsonl') && name !== 'journal.jsonl') {
      out.push(full);
    }
  }
}

// 读取 transcript NDJSON，逐行解析；跳过坏行，只保留带 type 的事件
export function readTranscript(filePath: string): TranscriptEntry[] {
  const raw = readFileSync(filePath, 'utf8');
  const out: TranscriptEntry[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object' && 'type' in obj) {
        out.push(obj as TranscriptEntry);
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return out;
}

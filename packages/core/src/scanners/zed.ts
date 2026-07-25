import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Zed threads.db 位置
export function zedThreadsDbPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Zed', 'threads', 'threads.db');
}

// Zed thread 元数据（不解析 zstd BLOB，只取摘要信息）
export interface ZedThreadMeta {
  id: string;
  summary: string;
  folderPaths: string | null;
  updatedAt: string;
  createdAt: string | null;
}

// 判断 threads.db 是否存在
export function hasZedThreadsDb(): boolean {
  try {
    statSync(zedThreadsDbPath());
    return true;
  } catch {
    return false;
  }
}

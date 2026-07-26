import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Zed threads.db 位置
export function zedThreadsDbPath() {
    return join(homedir(), 'Library', 'Application Support', 'Zed', 'threads', 'threads.db');
}
// 判断 threads.db 是否存在
export function hasZedThreadsDb() {
    try {
        statSync(zedThreadsDbPath());
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=zed.js.map
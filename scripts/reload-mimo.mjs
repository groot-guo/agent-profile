import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const dbPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'server', 'trace.db');
const db = new Database(dbPath);

const r1 = db
  .prepare(
    "DELETE FROM spans WHERE session_id IN (SELECT id FROM sessions WHERE agent = 'mimo-code')",
  )
  .run();
console.log('deleted mimo spans:', r1.changes);
const r2 = db.prepare("DELETE FROM sessions WHERE agent = 'mimo-code'").run();
console.log('deleted mimo sessions:', r2.changes);
db.close();
console.log('Done. Restart server to re-scan MiMo data with new title logic.');

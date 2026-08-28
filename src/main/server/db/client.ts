import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

/**
 * SQLite via the built-in `node:sqlite` module (no native dependency, works
 * identically under the user's Node and Electron). Drizzle runs in
 * sqlite-proxy mode: it only builds SQL + params; every statement executes
 * here through `DatabaseSync`.
 *
 * sqlite-proxy expects rows as arrays of column *values* (not objects) for
 * `all`/`get`/`values`; `DatabaseSync` returns objects, so we map with
 * `Object.values`, which preserves SELECT column order.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  raw: DatabaseSync;
  close(): void;
}

function runMigrations(raw: DatabaseSync): void {
  raw.exec(
    `CREATE TABLE IF NOT EXISTS __migrations (
       name TEXT PRIMARY KEY NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  const applied = new Set(
    (raw.prepare('SELECT name FROM __migrations').all() as { name: string }[]).map((r) => r.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    raw.exec('BEGIN');
    try {
      for (const stmt of migration.statements) raw.exec(stmt);
      raw.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      );
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Open (and migrate) the sessions database. Pass `:memory:` for tests.
 */
export function openDb(dbPath: string): DbHandle {
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  runMigrations(raw);

  const exec = (sql: string, params: unknown[], method: 'run' | 'all' | 'values' | 'get') => {
    const stmt = raw.prepare(sql);
    const bind = params as (null | number | bigint | string | Uint8Array)[];
    if (method === 'run') {
      stmt.run(...bind);
      return { rows: [] as unknown[] };
    }
    if (method === 'get') {
      const row = stmt.get(...bind) as Record<string, unknown> | undefined;
      return { rows: row ? Object.values(row) : [] };
    }
    // 'all' | 'values'
    const rows = stmt.all(...bind) as Record<string, unknown>[];
    return { rows: rows.map((r) => Object.values(r)) };
  };

  const db = drizzle(
    async (sql, params, method) => exec(sql, params, method),
    async (queries) => queries.map((q) => exec(q.sql, q.params, q.method)),
    { schema },
  );

  return { db, raw, close: () => raw.close() };
}

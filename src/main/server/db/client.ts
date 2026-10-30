import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
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

/** How many pre-migration copies to keep next to the database. */
const KEEP_PRE_MIGRATION_BACKUPS = 3;

/**
 * Before an existing database gets new migrations, copy it aside (`<db>.pre-<lastApplied>.bak`). A migration that
 * goes wrong then never costs the user their data, and the failure is loud: if the copy cannot be made, migrating
 * does not start. A fresh database (nothing applied yet) and an up-to-date one need no copy.
 */
export function backupBeforeMigrating(raw: DatabaseSync, dbPath: string): string | null {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return null;
  raw.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
  const applied = (raw.prepare('SELECT name FROM __migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  const pending = MIGRATIONS.filter((m) => !applied.includes(m.name));
  if (applied.length === 0 || pending.length === 0) return null;
  // Fold the write-ahead log into the main file so one file is a complete copy.
  raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const target = `${dbPath}.pre-${applied[applied.length - 1]}.bak`;
  copyFileSync(dbPath, target);
  pruneBackups(dbPath);
  return target;
}

function pruneBackups(dbPath: string): void {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.pre-`;
  const mine = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.bak')).sort();
  for (const stale of mine.slice(0, Math.max(0, mine.length - KEEP_PRE_MIGRATION_BACKUPS))) rmSync(path.join(dir, stale), { force: true });
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
  backupBeforeMigrating(raw, dbPath);
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

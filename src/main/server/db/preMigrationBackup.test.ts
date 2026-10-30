import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './client';
import { MIGRATIONS } from './migrations';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'reizo-premig-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A database as an older release left it: only the first `count` migrations applied, with one session in it. */
function oldDatabase(file: string, count: number): void {
  const raw = new DatabaseSync(file);
  raw.exec('CREATE TABLE __migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
  for (const m of MIGRATIONS.slice(0, count)) {
    for (const s of m.statements) raw.exec(s);
    raw.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(m.name, 1);
  }
  raw.exec("INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'keep me', 1, 1)");
  raw.close();
}

const backups = (): string[] => readdirSync(dir).filter((n) => n.endsWith('.bak')).sort();

it('copies an existing database aside before it gets new migrations', () => {
  const file = path.join(dir, 'app.db');
  oldDatabase(file, 2);
  openDb(file).close();
  expect(backups()).toEqual([`app.db.pre-${MIGRATIONS[1].name}.bak`]);
  const copy = new DatabaseSync(path.join(dir, backups()[0]));
  expect((copy.prepare("SELECT title FROM sessions WHERE id = 's1'").get() as { title: string }).title).toBe('keep me');
  // The copy is the old shape: it was taken before the later migrations ran.
  expect((copy.prepare('SELECT count(*) AS n FROM __migrations').get() as { n: number }).n).toBe(2);
  copy.close();
});

it('makes no copy for a brand-new database or one that is already up to date', () => {
  const file = path.join(dir, 'app.db');
  openDb(file).close();
  expect(backups()).toEqual([]);
  openDb(file).close();
  expect(backups()).toEqual([]);
});

it('keeps only the three newest copies', () => {
  const file = path.join(dir, 'app.db');
  for (const stale of ['0000_a', '0001_b', '0002_c']) writeFileSync(path.join(dir, `app.db.pre-${stale}.bak`), 'x');
  oldDatabase(file, 3);
  openDb(file).close();
  const kept = backups();
  expect(kept).toHaveLength(3);
  expect(existsSync(path.join(dir, `app.db.pre-${MIGRATIONS[2].name}.bak`))).toBe(true);
  expect(kept).not.toContain('app.db.pre-0000_a.bak');
});

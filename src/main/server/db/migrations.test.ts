import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migrations';

const dir = path.join(__dirname, 'migrations');
// Compare token content only: drizzle quotes identifiers and splits statements differently from the embedded copy.
const norm = (sql: string) => sql.replace(/-->\s*statement-breakpoint/g, '').replace(/^--.*$/gm, '').replace(/[`"';\s]/g, '').toLowerCase();

describe('migrations: embedded strings match migrations/*.sql', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  it('has the same ordered names', () => {
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
  });

  for (const migration of MIGRATIONS) {
    it(`${migration.name} is identical`, () => {
      const sql = readFileSync(path.join(dir, `${migration.name}.sql`), 'utf8');
      expect(norm(migration.statements.join(''))).toEqual(norm(sql));
    });
  }
});

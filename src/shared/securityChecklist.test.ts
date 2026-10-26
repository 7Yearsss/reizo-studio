import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const doc = readFileSync(path.join(root, 'docs/security-adversarial.md'), 'utf8');
const rows = [...doc.matchAll(/`(src\/[^`:]+?) :: ([^`]+)`/g)].map((m) => ({ file: m[1], name: m[2] }));

describe('docs/security-adversarial.md', () => {
  it('lists at least one row', () => expect(rows.length).toBeGreaterThan(0));

  for (const { file, name } of rows) {
    it(`${file} :: ${name}`, () => {
      const full = path.join(root, file);
      expect(existsSync(full), `missing test file ${file}`).toBe(true);
      const source = readFileSync(full, 'utf8');
      const quoted = [`'${name}'`, `"${name}"`, `\`${name}\``];
      expect(quoted.some((q) => source.includes(q)), `test "${name}" not found in ${file}`).toBe(true);
    });
  }
});

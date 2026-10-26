import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from './constants';

const root = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const preload = readFileSync(path.join(root, 'preload/preload.ts'), 'utf8');
const main = sources(path.join(root, 'main')).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('IPC contract', () => {
  for (const key of Object.keys(IPC)) {
    it(`IPC.${key} is exposed by preload and handled by main`, () => {
      expect(preload.includes(`IPC.${key}`), `preload.ts never uses IPC.${key}`).toBe(true);
      expect(main.includes(`IPC.${key}`), `no main-process module uses IPC.${key}`).toBe(true);
    });
  }

  it('channel values are unique', () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });
});

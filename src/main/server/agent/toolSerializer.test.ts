import { describe, expect, it } from 'vitest';
import { serializeMutatingTools } from './toolSerializer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function probe() {
  const log: string[] = [];
  const make = (name: string, ms: number, fail = false) => ({
    execute: async (_input?: unknown, _options?: unknown) => { log.push(`start:${name}`); await sleep(ms); log.push(`end:${name}`); if (fail) throw new Error('boom'); return name; },
  });
  return { log, make };
}

describe('serializeMutatingTools', () => {
  it('runs mutating tools one at a time in issue order', async () => {
    const { log, make } = probe();
    const tools = serializeMutatingTools({ edit_file: make('a', 20), write_file: make('b', 1) });
    await Promise.all([tools.edit_file.execute(undefined, undefined), tools.write_file.execute(undefined, undefined)]);
    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('keeps read-only tools concurrent', async () => {
    const { log, make } = probe();
    const tools = serializeMutatingTools({ read_file: make('a', 10), grep: make('b', 10) });
    await Promise.all([tools.read_file.execute(undefined, undefined), tools.grep.execute(undefined, undefined)]);
    expect(log.slice(0, 2)).toEqual(['start:a', 'start:b']);
  });

  it('a failing call does not block the next one', async () => {
    const { make } = probe();
    const tools = serializeMutatingTools({ edit_file: make('a', 1, true), write_file: make('b', 1) });
    const [first, second] = await Promise.allSettled([tools.edit_file.execute(undefined, undefined), tools.write_file.execute(undefined, undefined)]);
    expect(first.status).toBe('rejected');
    expect(second).toEqual({ status: 'fulfilled', value: 'b' });
  });
});

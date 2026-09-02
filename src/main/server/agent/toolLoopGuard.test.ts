import { describe, expect, it } from 'vitest';
import {
  createToolLoopGuard,
  inspectToolStream,
  toolSignature,
  type ToolOutcome,
} from './toolLoopGuard';

const err = (name: string, args: Record<string, unknown> = {}): ToolOutcome => ({
  name,
  args,
  ok: false,
});
const ok = (name: string, args: Record<string, unknown> = {}): ToolOutcome => ({
  name,
  args,
  ok: true,
});

describe('inspectToolStream', () => {
  it('is ok for a normal run', () => {
    expect(
      inspectToolStream([ok('read_file'), err('read_file'), ok('read_file'), ok('edit_file')]).tier,
    ).toBe('ok');
  });

  it('warns then halts on consecutive errors', () => {
    expect(inspectToolStream([err('a'), err('b'), err('c')]).tier).toBe('warn');
    expect(inspectToolStream([err('a'), err('b'), err('c'), err('d'), err('e'), err('f')]).tier).toBe(
      'halt',
    );
  });

  it('a success resets the consecutive-error streak', () => {
    expect(
      inspectToolStream([err('a'), err('b'), ok('x'), err('c'), err('d')]).tier,
    ).toBe('ok');
  });

  it('halts when the same signature keeps failing', () => {
    const same = Array.from({ length: 5 }, () => err('grep', { pattern: 'FooBar' }));
    expect(inspectToolStream(same).tier).toBe('halt');
  });

  it('a successful read does NOT clear a failing signature (non-mutating)', () => {
    const stream: ToolOutcome[] = [
      err('edit_file', { path: 'a.ts', find: 'x' }),
      ok('read_file', { path: 'a.ts' }),
      err('edit_file', { path: 'a.ts', find: 'x' }),
      ok('read_file', { path: 'a.ts' }),
      err('edit_file', { path: 'a.ts', find: 'x' }),
    ];
    // 3 identical edit_file failures interleaved with reads → warn (signature).
    expect(inspectToolStream(stream).tier).toBe('warn');
  });

  it('a successful mutating call clears the failing signature', () => {
    const stream: ToolOutcome[] = [
      err('edit_file', { path: 'a.ts', find: 'x' }),
      err('edit_file', { path: 'a.ts', find: 'x' }),
      err('edit_file', { path: 'a.ts', find: 'x' }),
      ok('edit_file', { path: 'a.ts', find: 'x' }),
    ];
    expect(inspectToolStream(stream).tier).toBe('ok');
  });

  it('toolSignature ignores object args but keeps scalars', () => {
    expect(toolSignature('t', { a: 1, b: 'hi', c: { deep: true } })).toBe('t(a=1&b=hi&c=[obj])');
  });
});

describe('createToolLoopGuard', () => {
  it('emits a verdict only when the tier rises', () => {
    const guard = createToolLoopGuard();
    expect(guard.record(err('a'))).toBeNull();
    expect(guard.record(err('b'))).toBeNull();
    const first = guard.record(err('c'));
    expect(first?.tier).toBe('warn');
    // Still warn — no new banner.
    expect(guard.record(err('d'))).toBeNull();
    expect(guard.record(err('e'))).toBeNull();
    const halt = guard.record(err('f'));
    expect(halt?.tier).toBe('halt');
  });
});

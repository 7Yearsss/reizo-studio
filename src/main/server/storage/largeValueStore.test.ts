import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLargeValueStore, SPILL_THRESHOLD_BYTES } from './largeValueStore';

function freshStore() {
  return createLargeValueStore(mkdtempSync(path.join(tmpdir(), 'reizo-refs-')));
}

describe('largeValueStore', () => {
  it('leaves small values inline', () => {
    expect(freshStore().maybeSpill('small')).toBeNull();
  });

  it('spills an oversized value and reads it back whole', () => {
    const store = freshStore();
    const big = 'x'.repeat(SPILL_THRESHOLD_BYTES + 1000);
    const ref = store.maybeSpill(big);
    expect(ref).not.toBeNull();
    expect(ref!.sizeBytes).toBe(Buffer.byteLength(big));
    expect(ref!.preview.length).toBeLessThan(big.length);
    const read = store.read(ref!.__ref);
    expect(read.status).toBe('ok');
    expect(read.status === 'ok' && read.content).toBe(big);
  });

  it('reports missing for an unknown id', () => {
    expect(freshStore().read('nope').status).toBe('missing');
  });

  it('spill failure throws (fail-closed), never falls back to inline', () => {
    // Point the store at a path where `refs/` can't be created (a file).
    const filePath = mkdtempSync(path.join(tmpdir(), 'reizo-refs-x-'));
    const store = createLargeValueStore(path.join(filePath, 'not-a-dir-parent', '\0invalid'));
    expect(() => store.maybeSpill('y'.repeat(SPILL_THRESHOLD_BYTES + 10))).toThrow();
  });
});

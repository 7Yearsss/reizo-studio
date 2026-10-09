import { describe, expect, it, vi } from 'vitest';
import { clearSheetRecovery, flushSheetEdits, registerSheetFlusher, setSheetRecovery, trackSheetWrite } from './sheetWorkspace';

describe('sheet saves before agent requests', () => {
  it('waits for this session only and propagates a failed save', async () => {
    const other = vi.fn(async () => { throw new Error('other session'); });
    const offOther = registerSheetFlusher('other', 'book-other', other);
    let saved = false;
    const off = registerSheetFlusher('current', 'book-current', async () => { await Promise.resolve(); saved = true; });
    await flushSheetEdits('current');
    expect(saved).toBe(true);
    expect(other).not.toHaveBeenCalled();
    off(); offOther();
    const failed = registerSheetFlusher('current', 'book-current', async () => { throw new Error('version conflict'); });
    await expect(flushSheetEdits('current')).rejects.toThrow('version conflict');
    failed();
  });
  it('waits for an unmounted editor write and retains its save error', async () => {
    let resolve!: () => void;
    const write = new Promise<void>((done) => { resolve = done; });
    trackSheetWrite('closing', write);
    let complete = false;
    const flush = flushSheetEdits('closing').then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    resolve(); await flush;
    setSheetRecovery('book-closing', { sessionId: 'closing', content: 'unsaved', expectedVersion: 1, error: 'network unavailable' });
    await expect(flushSheetEdits('closing')).rejects.toThrow('network unavailable');
    clearSheetRecovery('book-closing');
  });
});

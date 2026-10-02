import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchCanvasNode, readCanvasStream, readCanvasSyncStream } from './api';

afterEach(() => { vi.unstubAllGlobals(); });

const heartbeat = { v: 2, canvasId: 'c1', epoch: 'e1', kind: 'heartbeat', revision: 4 };

describe('canvas NDJSON transport', () => {
  it('sends the local patch owner as the server idempotency key for durable acknowledgement', async () => {
    const fetch = vi.fn(async () => Response.json({ node: { id: 'a' } }));
    vi.stubGlobal('fetch', fetch);
    await patchCanvasNode('c1', 'a', { x: 100 }, 'owner-1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:47100/api/canvas/c1/nodes/a', expect.objectContaining({ headers: { 'content-type': 'application/json', 'Idempotency-Key': 'owner-1' } }));
  });

  it('requests v2 and reads split chunks, invalid JSON and a final line without newline', async () => {
    const encoded = new TextEncoder().encode(`invalid\n${JSON.stringify(heartbeat)}\n${JSON.stringify({ ...heartbeat, revision: 5 })}`);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoded.slice(0, 19)); controller.enqueue(encoded.slice(19)); controller.close(); } });
    const fetch = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetch);
    const handler = vi.fn();
    await readCanvasSyncStream('c1', 4, handler);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:47100/api/canvas/c1/stream?protocol=2&after=4', expect.anything());
    expect(handler.mock.calls.map(([message]) => message.revision)).toEqual([4, 5]);
    expect(body.locked).toBe(false);
  });

  it('propagates consumer failures and cancels/unlocks the reader', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(heartbeat)}\n`)); }, cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const error = new Error('Resync required');
    await expect(readCanvasSyncStream('c1', 4, () => { throw error; })).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('aborts a waiting reader and never dispatches buffered events after abort', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(heartbeat)}\n${JSON.stringify(heartbeat)}\n`)); }, cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const handler = vi.fn(() => abort.abort());
    await expect(readCanvasSyncStream('c1', 4, handler, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('retains the v1 reader contract while propagating its consumer errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${JSON.stringify({ v: 1, canvasId: 'c1', rev: 4, epoch: 'e1', event: { type: 'heartbeat' } })}\n`)));
    const handler = vi.fn();
    await readCanvasStream('c1', 3, handler);
    expect(handler).toHaveBeenCalledWith({ type: 'heartbeat' }, 4);
    const error = new Error('Handler failed');
    await expect(readCanvasStream('c1', 3, () => { throw error; })).rejects.toBe(error);
  });
});

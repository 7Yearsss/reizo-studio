// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat stream transport', () => {
  it('rejects when the response ends before a terminal outcome', async () => {
    Object.defineProperty(window, 'reizo', {
      configurable: true,
      value: { getApiOrigin: vi.fn(async () => 'http://127.0.0.1:47100') },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          `${JSON.stringify({
            v: 1,
            sessionId: 's1',
            rev: 1,
            epoch: 'e1',
            event: { type: 'text', delta: 'partial' },
          })}\n`,
          { headers: { 'content-type': 'application/x-ndjson' } },
        ),
      ),
    );

    const api = await import('./api');
    await expect(
      api.sendMessage('s1', 'hello', { onEvent: vi.fn() }),
    ).rejects.toMatchObject({ name: 'ChatStreamIncompleteError' });
  });
});

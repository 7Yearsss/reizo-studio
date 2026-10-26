import { describe, expect, it } from 'vitest';
import { createAttachmentTools, READ_ATTACHMENT_TOOL } from './attachmentTools';

function fakeStore(items: Array<{ id: string; name: string; source: string; version: number; content: string }>) {
  return {
    listBySession: async () => items.map(({ content: _c, ...meta }) => meta),
    get: async (id: string) => items.find((i) => i.id === id),
  } as never;
}

type Result = { ok: boolean; text?: string; nextOffset?: number | null; total?: number; error?: string };
const run = (store: never, input: { name: string; offset?: number; length?: number }) =>
  (createAttachmentTools({ sessionId: 's', artifacts: store })[READ_ATTACHMENT_TOOL].execute as any)(input, {}) as Promise<Result>;

describe('read_attachment', () => {
  const store = fakeStore([
    { id: 'a1', name: 'big.txt', source: 'attachment', version: 1, content: `${'a'.repeat(25_000)}TAIL` },
    { id: 'g1', name: 'secret.md', source: 'agent', version: 1, content: 'not an attachment' },
  ]);

  it('reads the part after the inline cut, page by page', async () => {
    const first = await run(store, { name: 'big.txt', offset: 20_000 });
    expect(first.ok).toBe(true);
    expect(first.text?.endsWith('TAIL')).toBe(true);
    expect(first.nextOffset).toBeNull();
    expect(first.total).toBe(25_004);
  });

  it('only reaches attachments, and names what exists when asked for something else', async () => {
    const miss = await run(store, { name: 'secret.md' });
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('big.txt');
    expect(miss.error).not.toContain('secret.md",');
  });
});

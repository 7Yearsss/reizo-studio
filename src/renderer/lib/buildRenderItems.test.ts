import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../shared/chat';
import {
  buildRenderItems,
  initialWindowStart,
  snapWindowStart,
  WINDOW_INITIAL_ITEMS,
} from './buildRenderItems';

function convo(n: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
      createdAt: 'x',
    });
  }
  return out;
}

describe('buildRenderItems', () => {
  it('maps 1:1 with a stable key and marks user messages as turn starts', () => {
    const items = buildRenderItems(convo(4));
    expect(items.map((i) => i.key)).toEqual(['0', '1', '2', '3']);
    expect(items.map((i) => i.turnStart)).toEqual([true, false, true, false]);
  });

  it('counts tool part sizes into bytes', () => {
    const items = buildRenderItems([
      {
        id: 'a',
        role: 'assistant',
        content: 'hi',
        createdAt: 'x',
        parts: [{ type: 'tool', id: 't', name: 'grep', args: {}, result: 'x'.repeat(100) }],
      },
    ]);
    expect(items[0].bytes).toBeGreaterThan(100);
  });
});

describe('snapWindowStart', () => {
  it('walks back to the nearest turn boundary', () => {
    const items = buildRenderItems(convo(10));
    // index 5 is an assistant msg -> snap back to 4 (user)
    expect(snapWindowStart(items, 5)).toBe(4);
    // index 6 is a user msg -> unchanged
    expect(snapWindowStart(items, 6)).toBe(6);
  });

  it('never goes below 0', () => {
    expect(snapWindowStart(buildRenderItems(convo(4)), 1)).toBe(0);
  });
});

describe('initialWindowStart', () => {
  it('shows everything for a short conversation', () => {
    expect(initialWindowStart(buildRenderItems(convo(10)))).toBe(0);
  });

  it('caps a long conversation to roughly the last WINDOW_INITIAL_ITEMS, snapped to a turn', () => {
    const items = buildRenderItems(convo(300));
    const start = initialWindowStart(items);
    expect(start).toBeGreaterThan(0);
    expect(items.length - start).toBeGreaterThanOrEqual(WINDOW_INITIAL_ITEMS - 1);
    expect(items.length - start).toBeLessThan(WINDOW_INITIAL_ITEMS + 2);
    expect(items[start].turnStart).toBe(true);
  });

  it('tightens the window when trailing items blow the byte budget', () => {
    const msgs = convo(120);
    // make the last 40 items huge
    for (let i = 80; i < 120; i += 1) msgs[i].content = 'x'.repeat(5000);
    const items = buildRenderItems(msgs);
    const start = initialWindowStart(items);
    // fewer than the count cap because the byte budget kicked in first
    expect(items.length - start).toBeLessThan(WINDOW_INITIAL_ITEMS);
  });
});

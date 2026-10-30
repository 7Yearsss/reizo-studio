import { expect, test } from 'vitest';
import { createToolInputStreamer } from './toolInputStream';

test('the row appears when the call starts, with no args yet', () => {
  const s = createToolInputStreamer();
  expect(s.feed({ type: 'tool-input-start', id: 'c1', toolName: 'write_file' })).toEqual({ type: 'tool', id: 'c1', name: 'write_file', args: {} });
});

test('path shows up as soon as it is written, then stays quiet through the body', () => {
  const s = createToolInputStreamer();
  s.feed({ type: 'tool-input-start', id: 'c1', toolName: 'write_file' });
  expect(s.feed({ type: 'tool-input-delta', id: 'c1', delta: '{"path":"src/a.ts",' })).toEqual({ type: 'tool', id: 'c1', name: 'write_file', args: { path: 'src/a.ts' } });
  // A burst of body text with no new shown field produces no further events.
  let extra = 0;
  for (let i = 0; i < 50; i++) if (s.feed({ type: 'tool-input-delta', id: 'c1', delta: 'x'.repeat(40) })) extra++;
  expect(extra).toBe(0);
});

test('a growing command is re-sent only per step, never per token', () => {
  const s = createToolInputStreamer();
  s.feed({ type: 'tool-input-start', id: 'c2', toolName: 'run_command' });
  s.feed({ type: 'tool-input-delta', id: 'c2', delta: '{"command":"echo ' });
  let events = 0;
  for (let i = 0; i < 100; i++) if (s.feed({ type: 'tool-input-delta', id: 'c2', delta: 'ab' })) events++;
  expect(events).toBeGreaterThan(0);
  expect(events).toBeLessThanOrEqual(2000 / 160);
});

test('tools with renderer-side effects are not streamed early', () => {
  const s = createToolInputStreamer();
  expect(s.feed({ type: 'tool-input-start', id: 'c9', toolName: 'add_node' })).toBeNull();
  expect(s.feed({ type: 'tool-input-delta', id: 'c9', delta: '{"path":"x"}' })).toBeNull();
});

test('unknown calls, empty deltas and finished calls are ignored', () => {
  const s = createToolInputStreamer();
  expect(s.feed({ type: 'tool-input-delta', id: 'nope', delta: '{"path":"x"}' })).toBeNull();
  s.feed({ type: 'tool-input-start', id: 'c3', toolName: 'read_file' });
  expect(s.feed({ type: 'tool-input-delta', id: 'c3', delta: '' })).toBeNull();
  s.feed({ type: 'tool-input-end', id: 'c3' });
  expect(s.feed({ type: 'tool-input-delta', id: 'c3', delta: '{"path":"x"}' })).toBeNull();
  expect(s.feed({ type: 'text-delta', text: 'hi' })).toBeNull();
});

test('an HTML page being written is streamed whole, in coarse steps', () => {
  const s = createToolInputStreamer();
  s.feed({ type: 'tool-input-start', id: 'h1', toolName: 'write_file' });
  s.feed({ type: 'tool-input-delta', id: 'h1', delta: '{"path":"index.html","content":"<!doctype html><h1>Hi' });
  let last: Record<string, unknown> = {};
  let events = 0;
  for (let i = 0; i < 200; i++) {
    const ev = s.feed({ type: 'tool-input-delta', id: 'h1', delta: '<p>row</p>'.repeat(10) });
    if (ev && ev.type === 'tool') { last = ev.args; events++; }
  }
  expect(String(last.content).startsWith('<!doctype html><h1>Hi<p>row</p>')).toBe(true);
  expect(String(last.content).length).toBeGreaterThan(15000);
  expect(events).toBeLessThanOrEqual(20000 / 3000 + 2);
});

test('a non-HTML file keeps the short, content-free stream', () => {
  const s = createToolInputStreamer();
  s.feed({ type: 'tool-input-start', id: 'h2', toolName: 'write_file' });
  s.feed({ type: 'tool-input-delta', id: 'h2', delta: '{"path":"a.ts","content":"x' });
  for (let i = 0; i < 100; i++) {
    const ev = s.feed({ type: 'tool-input-delta', id: 'h2', delta: 'y'.repeat(200) });
    if (ev && ev.type === 'tool') expect(ev.args.content).toBeUndefined();
  }
});

test('HTML streaming stops at its cap', () => {
  const s = createToolInputStreamer();
  s.feed({ type: 'tool-input-start', id: 'h3', toolName: 'write_file' });
  s.feed({ type: 'tool-input-delta', id: 'h3', delta: '{"path":"big.html","content":"' });
  let size = 0;
  for (let i = 0; i < 400; i++) {
    const ev = s.feed({ type: 'tool-input-delta', id: 'h3', delta: 'z'.repeat(2000) });
    if (ev && ev.type === 'tool') size = String(ev.args.content).length;
  }
  expect(size).toBeLessThanOrEqual(300_000);
});

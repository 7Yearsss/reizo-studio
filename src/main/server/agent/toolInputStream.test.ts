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

import { expect, test } from 'vitest';
import { clearEditorRecovery, sessionsWithUnsavedEdits, setEditorRecovery, subscribeEditorState, trackEditorWrite } from './editorPersistence';

test('a failed save keeps its session marked unsaved until cleared, and subscribers hear about it', () => {
  let heard = 0;
  const off = subscribeEditorState(() => { heard++; });
  setEditorRecovery('art1', { sessionId: 's1', content: 'x', expectedVersion: 1, error: 'offline' });
  expect(sessionsWithUnsavedEdits().has('s1')).toBe(true);
  clearEditorRecovery('art1');
  expect(sessionsWithUnsavedEdits().has('s1')).toBe(false);
  expect(heard).toBe(2);
  off();
});

test('an in-flight write marks the session until it settles', async () => {
  let resolve: () => void = () => undefined;
  const write = trackEditorWrite('s2', new Promise<void>((r) => { resolve = r; }));
  expect(sessionsWithUnsavedEdits().has('s2')).toBe(true);
  resolve();
  await write;
  await Promise.resolve();
  expect(sessionsWithUnsavedEdits().has('s2')).toBe(false);
});

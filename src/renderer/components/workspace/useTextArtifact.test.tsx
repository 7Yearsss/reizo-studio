// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArtifactWithContent } from '../../../shared/artifact';
import { clearEditorRecovery, getEditorRecovery } from '../../state/editorPersistence';
import { useTextArtifact } from './useTextArtifact';
const api = vi.hoisted(() => ({ save: vi.fn(), upsert: vi.fn() }));
vi.mock('../../api', () => ({ addArtifactVersion: api.save }));
vi.mock('../../state/artifactStore', () => ({ upsertArtifact: api.upsert }));
const initial: ArtifactWithContent = { id: 'html-save-test', sessionId: 'session', name: 'page.html', kind: 'html', renderer: 'html', status: 'complete', mimeType: 'text/html', source: 'manual', version: 1, versionCount: 1, byteSize: 1, createdAt: '', updatedAt: '', content: '<p>initial</p>' };
let current: ReturnType<typeof useTextArtifact>; let host: HTMLDivElement; let root: Root;
function Harness({ artifact = initial }: { artifact?: ArtifactWithContent }) { current = useTextArtifact(artifact); return <p>{current.text}</p>; }
beforeEach(async () => {
  vi.clearAllMocks(); clearEditorRecovery(initial.id); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); clearEditorRecovery(initial.id); });
it('serializes simultaneous flushes and saves edits typed while a request is in flight', async () => {
  let resolve!: (value: ArtifactWithContent) => void;
  api.save.mockImplementationOnce(() => new Promise<ArtifactWithContent>((done) => { resolve = done; })).mockResolvedValueOnce({ ...initial, content: 'second', version: 3 });
  let first!: Promise<void>; let second!: Promise<void>;
  await act(async () => { current.change('first'); first = current.flush(); second = current.flush(); });
  expect(first).toBe(second); expect(api.save).toHaveBeenCalledTimes(1);
  await act(async () => { current.change('second'); resolve({ ...initial, content: 'first', version: 2 }); await first; });
  expect(api.save.mock.calls).toEqual([[initial.id, 'first', 1], [initial.id, 'second', 2]]);
  expect(current.getVersion()).toBe(3); expect(current.text).toBe('second'); expect(getEditorRecovery(initial.id)).toBeUndefined();
});
it('preserves a stale draft and never adopts a newer version as its save base', async () => {
  api.save.mockRejectedValue(new Error('version conflict'));
  await act(async () => { current.change('my edits'); await current.flush().catch((): void => { /* Expected conflict. */ }); });
  await act(async () => root.render(<Harness artifact={{ ...initial, content: 'someone else', version: 2 }} />));
  expect(current.text).toBe('my edits'); expect(current.getVersion()).toBe(1);
  expect(getEditorRecovery(initial.id)).toMatchObject({ content: 'my edits', expectedVersion: 1, error: 'version conflict' });
});

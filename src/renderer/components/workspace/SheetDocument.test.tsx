// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArtifactWithContent } from '../../../shared/artifact';
import { emptyWorkbook, serializeSheetContent } from '../../../shared/sheetContent';
import { clearSheetRecovery, getSheetRecovery } from '../../state/sheetWorkspace';
import SheetDocument from './SheetDocument';

const harness = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), upsert: vi.fn(), mount: vi.fn(), content: '' }));
vi.mock('../../api', () => ({ getArtifact: harness.get, addArtifactVersion: harness.save }));
vi.mock('../../state/artifactStore', () => ({ upsertArtifact: harness.upsert }));
vi.mock('../DeferredView', () => ({ createDeferredView: () => function Editor(props: { text: string; onCommitDraft?: (text: string) => Promise<void> }) {
  useEffect(() => { harness.mount(); }, []);
  return <><pre>{props.text}</pre><button onClick={() => void props.onCommitDraft?.(harness.content).catch((): void => undefined)}>save</button></>;
} }));
vi.mock('./ArtifactVersionRail', () => ({ default: (): null => null }));

let root: Root;
let element: HTMLDivElement;
const initial: ArtifactWithContent = { id: 'sheet-doc-test', sessionId: 'sheet-session', name: '预算.xlsx', kind: 'sheet', renderer: 'sheet', status: 'complete', mimeType: 'application/vnd.reizo.sheet+json', source: 'manual', version: 1, versionCount: 1, byteSize: 1, createdAt: '', updatedAt: '', content: serializeSheetContent(emptyWorkbook('Original')) };
beforeEach(() => {
  vi.clearAllMocks();
  clearSheetRecovery(initial.id);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  harness.get.mockResolvedValue(initial);
  harness.content = serializeSheetContent(emptyWorkbook('Manual edit'));
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); clearSheetRecovery(initial.id); });

it('keeps the editor mounted after autosave but replaces it for an external agent version', async () => {
  const saved = { ...initial, version: 2, content: harness.content };
  harness.save.mockResolvedValue(saved);
  await act(async () => { root.render(<SheetDocument artifact={initial} onClose={() => undefined} />); });
  expect(harness.mount).toHaveBeenCalledTimes(1);
  await act(async () => { [...element.querySelectorAll('button')].find((b) => b.textContent === 'save')!.click(); });
  expect(harness.save).toHaveBeenCalledWith(initial.id, harness.content, 1);
  await act(async () => { root.render(<SheetDocument artifact={saved} onClose={() => undefined} />); });
  expect(harness.mount).toHaveBeenCalledTimes(1);
  const external = { ...saved, version: 3, content: serializeSheetContent(emptyWorkbook('Agent edit')) };
  harness.get.mockResolvedValue(external);
  await act(async () => { root.render(<SheetDocument artifact={external} onClose={() => undefined} />); });
  expect(harness.mount).toHaveBeenCalledTimes(2);
  expect(element.textContent).toContain('Agent edit');
});

it('retains unsaved content and its original base after a rejected stale save', async () => {
  harness.save.mockRejectedValue(new Error('version changed'));
  await act(async () => { root.render(<SheetDocument artifact={initial} onClose={() => undefined} />); });
  await act(async () => { [...element.querySelectorAll('button')].find((b) => b.textContent === 'save')!.click(); });
  expect(getSheetRecovery(initial.id)).toMatchObject({ content: harness.content, expectedVersion: 1, error: 'version changed' });
  expect(element.textContent).toContain('version changed');
});

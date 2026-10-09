// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { createDocumentContent, documentBlocks } from '../../../shared/documentContent';
import DocumentReview from './DocumentReview';

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function fixture(): ArtifactReview {
  const base = createDocumentContent({ type: 'doc', content: [
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '项目预计十月上线，由甲方负责。', marks: [{ type: 'runStyle', attrs: { color: 'ff0000', size: 24 } }] }] },
  ] });
  const id = documentBlocks(base)[0].id;
  return { id: 'r1', artifactId: 'a', sessionId: 's', kind: 'doc', initialVersion: 1, baseVersion: 1, reviewVersion: 1, baseContent: JSON.stringify(base), candidateContent: '', origin: { surface: 'chat' }, status: 'pending', stale: false, createdAt: '', updatedAt: '',
    changes: [
      { id: 'c1', label: '插入「一」', operation: { op: 'replaceText', blockId: id, start: 5, end: 5, text: '一' }, before: '', after: '', status: 'pending' },
      { id: 'c2', label: '「甲」→「乙」', operation: { op: 'replaceText', blockId: id, start: 10, end: 11, text: '乙' }, before: '', after: '', status: 'pending' },
    ] };
}

it('shows changes inside the formatted paragraph, navigates between them and decides one at a time', async () => {
  const decide = vi.fn();
  await act(async () => { root.render(<DocumentReview review={fixture()} otherBatches={0} busy={false} decide={decide} revise={async () => true} />); });
  const surface = host.querySelector('[aria-label="带修改标记的文档"]')!;
  // One paragraph, original layout and styling intact, only the changed characters are marked.
  expect(surface.querySelectorAll('p').length).toBe(1);
  expect(surface.querySelector('p')!.getAttribute('style')).toContain('text-align: center');
  expect(surface.querySelector('span[style*="rgb(255, 0, 0)"]')).toBeTruthy();
  expect(surface.querySelector('ins')!.textContent).toBe('一');
  expect(surface.querySelector('del')!.textContent).toBe('甲');
  expect(host.querySelector('[role="status"]')!.textContent).toBe('第 1 / 2 处');

  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="下一处"]')!.click(); });
  expect(host.querySelector('[role="status"]')!.textContent).toBe('第 2 / 2 处');
  expect(surface.querySelector('.rv-active')!.textContent).toBe('甲');

  const accept = [...host.querySelectorAll('button')].find((b) => b.textContent === '接受')!;
  await act(async () => { accept.click(); });
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), ['c2'], 'accept');
});

it('offers a side-by-side view where each side hides the other side’s marks', async () => {
  await act(async () => { root.render(<DocumentReview review={fixture()} otherBatches={0} busy={false} decide={vi.fn()} revise={async () => true} />); });
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === '对照')!.click(); });
  expect(host.querySelector('.rv-before ins')).toBeTruthy();
  expect(host.querySelector('.rv-after del')).toBeTruthy();
  expect(host.querySelectorAll('.document-review').length).toBe(2);
});

it('does not invent spacing for paragraphs that carry no spacing attributes', async () => {
  await act(async () => { root.render(<DocumentReview review={fixture()} otherBatches={0} busy={false} decide={vi.fn()} revise={async () => true} />); });
  expect(host.querySelector('p')!.getAttribute('style')).not.toMatch(/margin|text-indent/);
});

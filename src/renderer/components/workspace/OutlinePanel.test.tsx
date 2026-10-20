// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDocumentContent, documentExtensions } from '../../../shared/documentContent';
import OutlinePanel, { outlineOf } from './OutlinePanel';

let editor: Editor; let host: HTMLDivElement; let root: Root;
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const content = createDocumentContent({ type: 'doc', content: [
    p('关于安全生产工作的通知'), p('各部门：'), p('一、总体要求'), p('各单位要认真落实各项措施，确保全年无事故。'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '工作目标' }] }, p('（一）基本原则'), p('二、主要措施'),
  ] });
  editor = new Editor({ extensions: documentExtensions(), content: content.doc, element: document.createElement('div') });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); editor.destroy(); });

it('lists the title and the numbered and styled headings, not the body, with positions', () => {
  const items = outlineOf(editor);
  expect(items.map((i) => [i.role, i.text])).toEqual([['title', '关于安全生产工作的通知'], ['heading1', '一、总体要求'], ['heading2', '工作目标'], ['heading2', '（一）基本原则'], ['heading1', '二、主要措施']]);
  expect(editor.state.doc.nodeAt(items[1].pos)?.textContent).toBe('一、总体要求');
});

it('jumps by moving the caret to the heading when an entry is clicked', async () => {
  await act(async () => { root.render(<OutlinePanel editor={editor} scroller={null} />); });
  const entry = [...host.querySelectorAll('button')].find((b) => b.textContent === '二、主要措施')!;
  await act(async () => { entry.click(); });
  expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe('二、主要措施');
});

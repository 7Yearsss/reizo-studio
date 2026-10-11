// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentContent, documentExtensions } from '../../../shared/documentContent';
import { readFormatState, setBlockAttrs, setRunStyle } from './documentFormatCommands';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });
function make() {
  const content = createDocumentContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '甲乙丙丁' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '戊己', marks: [{ type: 'runStyle', attrs: { color: 'ff0000', size: 10, font: null, highlight: null, vert: null } }] }] },
  ] });
  editor = new Editor({ extensions: documentExtensions(), content: content.doc, element: document.createElement('div') });
  return editor;
}
const marksAt = (e: Editor, from: number, to: number) => { const out: unknown[] = []; e.state.doc.nodesBetween(from, to, (n) => { if (n.isText) out.push(n.marks.find((m) => m.type.name === 'runStyle')?.attrs ?? null); }); return out; };

describe('setRunStyle', () => {
  it('applies a font and size to the selection and keeps the colour a run already had', () => {
    const e = make();
    e.commands.setTextSelection({ from: 3, to: 5 }); // 乙丙
    setRunStyle(e, { font: '黑体', size: 16 });
    expect(e.state.doc.textContent.slice(0, 4)).toBe('甲乙丙丁');
    expect(marksAt(e, 3, 5)).toEqual([{ font: '黑体', size: 16, color: null, highlight: null, vert: null }]);
    // Second paragraph: change only the font; its red colour and size stay.
    const secondStart = e.state.doc.child(0).nodeSize + 1;
    e.commands.setTextSelection({ from: secondStart, to: secondStart + 2 });
    setRunStyle(e, { font: '宋体' });
    expect(marksAt(e, secondStart, secondStart + 2)).toEqual([{ font: '宋体', size: 10, color: 'ff0000', highlight: null, vert: null }]);
  });
  it('clears a style when every field ends up empty', () => {
    const e = make();
    const secondStart = e.state.doc.child(0).nodeSize + 1;
    e.commands.setTextSelection({ from: secondStart, to: secondStart + 2 });
    setRunStyle(e, { color: null, size: null });
    expect(marksAt(e, secondStart, secondStart + 2)).toEqual([null]);
  });
});

describe('setBlockAttrs and readFormatState', () => {
  it('sets alignment, indent and line spacing on every paragraph in the selection and reads them back', () => {
    const e = make();
    e.commands.setTextSelection({ from: 2, to: e.state.doc.content.size - 2 });
    setBlockAttrs(e, { textAlign: 'center', indentFirst: 420, lineSpacing: 1.5, lineExact: null });
    expect(e.state.doc.child(0).attrs).toMatchObject({ textAlign: 'center', indentFirst: 420, lineSpacing: 1.5 });
    expect(e.state.doc.child(1).attrs).toMatchObject({ textAlign: 'center', indentFirst: 420, lineSpacing: 1.5 });
    e.commands.setTextSelection(2);
    expect(readFormatState(e)).toMatchObject({ align: 'center', indentFirst: 420, lineSpacing: 1.5, lineExact: null });
  });
  it('reads a run style from the selection', () => {
    const e = make();
    const secondStart = e.state.doc.child(0).nodeSize + 1;
    e.commands.setTextSelection({ from: secondStart, to: secondStart + 2 });
    expect(readFormatState(e)).toMatchObject({ color: 'ff0000', size: 10 });
  });
});

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react';
import { Editor, type EditorOptions } from '@pierre/diffs/edit';
import type { HtmlSelection } from '../../../shared/htmlContent';
import { useIsDark } from '../../lib/hooks/use-is-dark';

export interface HtmlCodeHandle { selection(): HtmlSelection | undefined; undo(): void; redo(): void }
export default forwardRef<HtmlCodeHandle, { name: string; text: string; onChange(text: string): void }>(function HtmlCodeEditor({ name, text, onChange }, ref) {
  const instance = useRef<Editor<undefined> | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const dark = useIsDark();
  const file = useMemo(() => ({ name, contents: text }), [name, text]);
  // Version 1.3.6 uses an options-only factory. Do not apply newer package signatures.
  const options = useMemo<EditorOptions<undefined>>(() => ({ onAttach: (editor) => { instance.current = editor; }, onChange: (next) => onChangeRef.current(next.contents) }), []);
  useImperativeHandle(ref, () => ({
    selection() {
      const editor = instance.current; const range = editor?.getState().selections?.[0]; if (!editor || !range) return;
      const content = editor.getText(); const lines = content.split('\n');
      const offset = (position: { line: number; character: number }) => lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
      const start = offset(range.start); const end = offset(range.end);
      return end > start ? { start, end, text: content.slice(start, end).slice(0, 2000) } : undefined;
    },
    undo() { instance.current?.undo(); }, redo() { instance.current?.redo(); },
  }), []);
  return <div className="h-full" aria-label="HTML 源码编辑器"><EditProvider createEditor={(settings) => new Editor(settings)}><Virtualizer style={{ height: '100%', overflow: 'auto' }}><File file={file} edit editorOptions={options} options={{ theme: dark ? 'pierre-dark' : 'pierre-light', disableFileHeader: true }} disableWorkerPool /></Virtualizer></EditProvider></div>;
});

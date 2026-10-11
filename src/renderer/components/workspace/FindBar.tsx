import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/cn';
import { isImeComposingEvent } from '../../lib/ime';
import { docSearchKey, type SearchMeta, type SearchState } from './docSearch';

const IDLE: SearchState = { query: '', caseSensitive: false, matches: [], current: -1 };

function dispatchSearch(editor: Editor, meta: SearchMeta): void {
  editor.view.dispatch(editor.state.tr.setMeta(docSearchKey, meta).setMeta('addToHistory', false));
}

/** Bring the match into view without touching the selection (the find bar keeps focus). */
function reveal(editor: Editor, box: HTMLElement | null, index: number): void {
  const match = docSearchKey.getState(editor.state)?.matches[index];
  if (!match || !box) return;
  try {
    const at = editor.view.coordsAtPos(match.from);
    const rect = box.getBoundingClientRect();
    if (at.top < rect.top + 80 || at.bottom > rect.bottom - 40) box.scrollTo({ top: box.scrollTop + (at.top - rect.top) - rect.height / 3, behavior: 'smooth' });
  } catch { /* the match is not laid out yet */ }
}

/** Find (and replace) across the document, in the corner of the page like Word's. */
export default function FindBar({ editor, scroller, replaceOpen, canReplace, initialQuery, onToggleReplace, onClose }: {
  editor: Editor;
  scroller: HTMLElement | null;
  replaceOpen: boolean;
  canReplace: boolean;
  initialQuery: string;
  onToggleReplace(): void;
  onClose(): void;
}) {
  const state = useEditorState({ editor, selector: ({ editor: e }) => (e && !e.isDestroyed ? docSearchKey.getState(e.state) ?? IDLE : IDLE) });
  const [replacement, setReplacement] = useState('');
  const queryInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialQuery);

  useEffect(() => {
    queryInput.current?.focus();
    queryInput.current?.select();
    dispatchSearch(editor, { query: initialQuery, current: 0 });
    reveal(editor, scroller, 0);
    return () => { if (!editor.isDestroyed) dispatchSearch(editor, { query: '' }); };
    // The bar mounts once per opening; later typing goes through `search`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const search = (query: string, caseSensitive = state.caseSensitive) => { setText(query); dispatchSearch(editor, { query, caseSensitive, current: 0 }); reveal(editor, scroller, 0); };
  const go = (step: number) => {
    const n = state.matches.length;
    if (!n) return;
    const next = (state.current + step + n) % n;
    dispatchSearch(editor, { current: next });
    reveal(editor, scroller, next);
  };
  const replaceCurrent = () => {
    const match = state.matches[state.current];
    if (!match || !canReplace) return;
    editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to));
    reveal(editor, scroller, Math.min(state.current, Math.max(state.matches.length - 2, 0)));
  };
  const replaceAll = () => {
    if (!canReplace || !state.matches.length) return;
    const tr = editor.state.tr;
    for (const match of [...state.matches].reverse()) tr.insertText(replacement, match.from, match.to);
    editor.view.dispatch(tr);
  };

  const count = !text ? '' : state.matches.length ? `${state.current + 1}/${state.matches.length}` : '无结果';
  const field = 'h-7 min-w-0 flex-1 rounded-lg bg-paper-inset px-2 text-sm text-ink outline-none placeholder:text-ink-muted';
  const key = (event: React.KeyboardEvent, onEnter: () => void) => {
    if (isImeComposingEvent(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'Enter') { event.preventDefault(); onEnter(); }
  };
  return (
    <div role="search" aria-label="查找和替换" className="absolute right-4 top-2 z-20 w-[22rem] max-w-[calc(100%-2rem)] rounded-2xl bg-paper-raised p-1.5 shadow-[var(--shadow-outline),0_8px_32px_rgba(25,47,80,0.16)]">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label={replaceOpen ? '收起替换' : '展开替换'} aria-expanded={replaceOpen} onClick={onToggleReplace}>
          <ChevronRight className={cn('transition-transform', replaceOpen && 'rotate-90')} />
        </Button>
        <input ref={queryInput} value={text} onChange={(event) => search(event.target.value)} onKeyDown={(event) => key(event, () => go(event.shiftKey ? -1 : 1))} placeholder="查找" aria-label="查找内容" className={field} />
        <span aria-live="polite" className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">{count}</span>
        <Button size="icon-sm" variant="ghost" className={cn('size-7 shrink-0', state.caseSensitive && 'bg-paper-inset text-ink')} aria-label="区分大小写" aria-pressed={state.caseSensitive} onClick={() => search(text, !state.caseSensitive)}><CaseSensitive /></Button>
        <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="上一个" disabled={!state.matches.length} onClick={() => go(-1)}><ArrowUp /></Button>
        <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="下一个" disabled={!state.matches.length} onClick={() => go(1)}><ArrowDown /></Button>
        <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="关闭查找" onClick={onClose}><X /></Button>
      </div>
      {replaceOpen && (
        <div className="mt-1 flex items-center gap-1 pl-8">
          <input value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => key(event, replaceCurrent)} placeholder="替换为" aria-label="替换内容" disabled={!canReplace} className={cn(field, 'disabled:opacity-50')} />
          <Button size="xs" variant="ghost" disabled={!canReplace || !state.matches.length} onClick={replaceCurrent}>替换</Button>
          <Button size="xs" variant="ghost" disabled={!canReplace || !state.matches.length} onClick={replaceAll}>全部替换</Button>
        </div>
      )}
    </div>
  );
}

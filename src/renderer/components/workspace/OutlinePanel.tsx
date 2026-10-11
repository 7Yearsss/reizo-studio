import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { classifyBlocks, type FormatRole } from '../../../shared/documentFormat';
import { cn } from '../../lib/cn';

export interface OutlineItem { pos: number; role: FormatRole; text: string }

const LEVEL: Partial<Record<FormatRole, number>> = { title: 0, heading1: 0, heading2: 1, heading3: 2, heading4: 3 };

/** The title and headings of the document, found the way typesetting finds them (numbered lines count, not just Word heading styles). */
export function outlineOf(editor: Editor): OutlineItem[] {
  const doc = editor.state.doc;
  const nodes = (doc.toJSON().content ?? []) as JSONContent[];
  const roles = classifyBlocks(nodes);
  const positions: number[] = [];
  doc.forEach((_node, offset) => positions.push(offset));
  const items: OutlineItem[] = [];
  nodes.forEach((node, i) => {
    const role = roles[i];
    if (!role || role === 'body') return;
    const text = (node.content ?? []).map((n) => n.text ?? '').join('').replace(/\s+/g, ' ').trim();
    if (text) items.push({ pos: positions[i], role, text });
  });
  return items;
}

/** A navigation list beside the page: where you are, and a click to jump to any heading. */
export default function OutlinePanel({ editor, scroller }: { editor: Editor; scroller: HTMLElement | null }) {
  const [items, setItems] = useState<OutlineItem[]>(() => outlineOf(editor));
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const refresh = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!editor.isDestroyed) setItems(outlineOf(editor)); }, 250); };
    editor.on('update', refresh);
    return () => { editor.off('update', refresh); clearTimeout(timer.current); };
  }, [editor]);

  const locate = useCallback(() => {
    if (!scroller || editor.isDestroyed) return;
    const line = scroller.getBoundingClientRect().top + 96;
    let current = -1;
    items.forEach((item, index) => {
      const dom = editor.view.nodeDOM(item.pos) as HTMLElement | null;
      if (dom?.getBoundingClientRect && dom.getBoundingClientRect().top <= line) current = index;
    });
    setActive(current);
  }, [editor, items, scroller]);

  useEffect(() => {
    locate();
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(locate); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [locate, scroller]);

  const jump = (item: OutlineItem) => {
    const dom = editor.view.nodeDOM(item.pos) as HTMLElement | null;
    editor.commands.setTextSelection(item.pos + 1);
    dom?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  return (
    <nav aria-label="文档大纲" className="scrollbar-hide w-56 shrink-0 overflow-y-auto border-r border-line bg-paper-raised py-2">
      {items.length === 0 ? <p className="px-3 py-2 text-xs text-ink-muted">没有标题</p> : (
        <ul className="flex flex-col gap-px px-1.5">
          {items.map((item, index) => (
            <li key={item.pos}>
              <button
                type="button"
                title={item.text}
                aria-current={index === active ? 'location' : undefined}
                onClick={() => jump(item)}
                style={{ paddingLeft: 8 + (LEVEL[item.role] ?? 0) * 12 }}
                className={cn(
                  'block w-full truncate rounded-lg py-1 pr-2 text-left text-[13px] leading-5 transition-colors hover:bg-paper-inset hover:text-ink',
                  index === active ? 'bg-paper-inset font-medium text-ink' : 'text-ink-muted',
                  item.role === 'title' && 'font-medium text-ink',
                )}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

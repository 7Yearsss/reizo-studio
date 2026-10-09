import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DOMSerializer } from '@tiptap/pm/model';
import { ChevronDown, ChevronUp, Check, X, Pencil } from 'lucide-react';
import { documentReviewSchema, reviewDocumentEdits } from '../../../shared/documentReview';
import { parseDocumentContent, typographyCss, type DocumentEdit } from '../../../shared/documentContent';
import type { ArtifactReview, ArtifactReviewChange } from '../../../shared/artifactReview';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { cssToStyle } from './DocumentReadOnly';

type Mode = 'inline' | 'split';
type Kind = 'replace' | 'insert' | 'delete' | 'format';
const CHANGE_SELECTOR = 'ins[data-id], del[data-id], [data-type="modification"][data-id]';
const KIND_LABEL: Record<Kind, string> = { replace: '改写', insert: '新增', delete: '删除', format: '格式' };
const KIND_COLOR: Record<Kind, string> = { replace: 'var(--accent)', insert: '#16a34a', delete: 'var(--destructive)', format: 'var(--ink-muted)' };

function changeIdOf(element: Element): string | null {
  try { const value = JSON.parse(element.getAttribute('data-id') ?? 'null'); return typeof value === 'string' ? value : null; } catch { return null; }
}

/** Document-order change ids plus what kind of change each one is, read from rendered review markup. */
function scan(host: HTMLElement | null): { order: string[]; kinds: Record<string, Kind> } {
  const order: string[] = []; const parts: Record<string, { ins: boolean; del: boolean; mod: boolean }> = {};
  host?.querySelectorAll(CHANGE_SELECTOR).forEach((element) => {
    const id = changeIdOf(element); if (!id) return;
    if (!parts[id]) { parts[id] = { ins: false, del: false, mod: false }; order.push(id); }
    if (element.tagName === 'INS') parts[id].ins = true; else if (element.tagName === 'DEL') parts[id].del = true; else parts[id].mod = true;
  });
  const kinds: Record<string, Kind> = {};
  for (const id of order) { const p = parts[id]; kinds[id] = p.ins && p.del ? 'replace' : p.ins ? 'insert' : p.del ? 'delete' : p.mod ? 'format' : 'replace'; }
  return { order, kinds };
}

function markActive(host: HTMLElement | null, activeId: string | undefined) {
  host?.querySelectorAll('.rv-active').forEach((element) => element.classList.remove('rv-active'));
  if (!host || !activeId) return;
  host.querySelectorAll(CHANGE_SELECTOR).forEach((element) => { if (changeIdOf(element) === activeId) element.classList.add('rv-active'); });
}

function markHover(hosts: (HTMLElement | null)[], hoverId: string | undefined) {
  for (const host of hosts) {
    host?.querySelectorAll('.rv-hover').forEach((element) => element.classList.remove('rv-hover'));
    if (host && hoverId) host.querySelectorAll(CHANGE_SELECTOR).forEach((element) => { if (changeIdOf(element) === hoverId) element.classList.add('rv-hover'); });
  }
}

function firstElement(host: HTMLElement | null, id: string | undefined): Element | null {
  if (!host || !id) return null;
  for (const element of Array.from(host.querySelectorAll(CHANGE_SELECTOR))) if (changeIdOf(element) === id) return element;
  return null;
}

const reasonOf = (change: ArtifactReviewChange | undefined): string | undefined => {
  const reason = (change?.operation as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
};

interface Props {
  review: ArtifactReview;
  otherBatches: number;
  busy: boolean;
  decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject'): void;
  revise(review: ArtifactReview, change: ArtifactReviewChange, text: string): Promise<boolean>;
}

/** Reviews AI edits in place: the document keeps its own layout, changed words are marked where they occur. */
export default function DocumentReview({ review, otherBatches, busy, decide, revise }: Props) {
  const [mode, setMode] = useState<Mode>('inline');
  const [activeId, setActiveId] = useState<string | undefined>();
  const [hoverId, setHoverId] = useState<string | undefined>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  const [layout, setLayout] = useState<{ tops: Record<string, number>; height: number }>({ tops: {}, height: 0 });
  const wrapper = useRef<HTMLDivElement>(null);
  const inlineHost = useRef<HTMLDivElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null);
  const afterHost = useRef<HTMLDivElement>(null);
  // 'first' on open, then the neighbour of whatever was just decided.
  const scrollTarget = useRef<string | undefined>('first');
  const pending = useMemo(() => review.changes.filter((c) => c.status === 'pending'), [review.changes]);
  const content = useMemo(() => parseDocumentContent(review.baseContent), [review.baseContent]);
  const style = useMemo(() => cssToStyle(typographyCss(content)), [content]);
  const sorted = useMemo(() => [...order, ...pending.map((c) => c.id).filter((id) => !order.includes(id))].filter((id) => pending.some((c) => c.id === id)), [order, pending]);
  const active = pending.find((c) => c.id === activeId) ?? pending.find((c) => c.id === sorted[0]);
  const index = active ? sorted.indexOf(active.id) : -1;
  // The change the buttons act on: the one being edited, else the one under the pointer, else the current one.
  const shown = pending.find((c) => c.id === (editing ?? hoverId)) ?? active;
  const readHost = () => (mode === 'inline' ? inlineHost.current : afterHost.current);

  // Render the projected document (base + suggestion marks) into the visible host(s).
  useEffect(() => {
    setFailed(false);
    const hosts = (mode === 'inline' ? [inlineHost.current] : [beforeHost.current, afterHost.current]).filter((h): h is HTMLDivElement => Boolean(h));
    if (!content) { setFailed(true); return; }
    try {
      const projected = documentReviewSchema.nodeFromJSON(reviewDocumentEdits(content, pending.map((c) => ({ edit: c.operation as DocumentEdit, changeId: c.id }))));
      const serializer = DOMSerializer.fromSchema(documentReviewSchema);
      for (const host of hosts) host.replaceChildren(serializer.serializeFragment(projected.content));
      const found = scan(hosts[0]); setOrder(found.order); setKinds(found.kinds);
    } catch { setFailed(true); }
  }, [content, pending, mode]);

  // Vertical position of every change inside the scrolling content, for the gutter toolbar and the overview rail.
  const measure = useCallback(() => {
    const scroller = wrapper.current; const host = readHost();
    if (!scroller || !host) return;
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const tops: Record<string, number> = {};
    for (const id of sorted) { const element = firstElement(host, id); if (element) tops[id] = element.getBoundingClientRect().top - origin; }
    setLayout({ tops, height: scroller.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, mode]);

  useEffect(() => {
    for (const host of [inlineHost.current, beforeHost.current, afterHost.current]) markActive(host, active?.id);
    measure();
  }, [active?.id, order, mode, measure]);
  useEffect(() => {
    const observer = new ResizeObserver(() => measure());
    if (wrapper.current) observer.observe(wrapper.current);
    const host = readHost(); if (host) observer.observe(host);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);
  useEffect(() => { setEditing(null); }, [active?.id]);
  useEffect(() => { markHover([inlineHost.current, beforeHost.current, afterHost.current], hoverId); }, [hoverId, order, mode]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const reveal = useCallback((id: string | undefined, behavior: ScrollBehavior = 'smooth') => {
    for (const host of [readHost(), beforeHost.current]) firstElement(host, id)?.scrollIntoView({ block: 'center', behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // Bring the first change into view when the review opens, and the next one after each decision.
  useEffect(() => {
    if (!sorted.length || !scrollTarget.current) return;
    const id = scrollTarget.current === 'first' ? sorted[0] : scrollTarget.current;
    if (!firstElement(readHost(), id)) return;
    scrollTarget.current = undefined; setActiveId(id); reveal(id, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, reveal]);

  function go(delta: number) {
    if (!sorted.length) return;
    const next = sorted[(Math.max(index, 0) + delta + sorted.length) % sorted.length];
    setActiveId(next); reveal(next);
  }
  const onPick = (event: React.MouseEvent) => {
    const hit = (event.target as Element).closest(CHANGE_SELECTOR);
    if ((event.target as Element).closest('a')) event.preventDefault();
    const id = hit ? changeIdOf(hit) : null;
    if (id) setActiveId(id);
  };
  const onHover = (event: React.MouseEvent) => {
    const target = event.target as Element;
    if (editing || target.closest('[data-rv-toolbar]')) { clearTimeout(hoverTimer.current); return; }
    const hit = target.closest(CHANGE_SELECTOR);
    const id = hit ? changeIdOf(hit) : null;
    clearTimeout(hoverTimer.current);
    if (id) setHoverId(id);
    // Short grace period so the pointer can travel from the text to the buttons in the gutter.
    else hoverTimer.current = setTimeout(() => setHoverId(undefined), 350);
  };
  const act = (ids: string[], decision: 'accept' | 'reject') => {
    // Land on the neighbouring change once this one is resolved.
    const at = ids.length === 1 ? sorted.indexOf(ids[0]) : index;
    const nextId = sorted[at + 1] ?? sorted[at - 1];
    scrollTarget.current = nextId; setActiveId(nextId); setHoverId(undefined); decide(review, ids, decision);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input') || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'j') go(1);
    else if (key === 'k') go(-1);
    else if (key === 'enter' && !target.closest('button') && active && !busy && !review.stale) act([active.id], 'accept');
    else if ((key === 'backspace' || key === 'delete') && active && !busy) act([active.id], 'reject');
    else return;
    event.preventDefault();
  };
  const allIds = pending.map((c) => c.id);
  const editable = shown && (shown.operation as DocumentEdit).op === 'replaceText';
  const counts = (Object.keys(KIND_LABEL) as Kind[]).map((kind) => [kind, sorted.filter((id) => kinds[id] === kind).length] as const).filter(([, n]) => n > 0);
  const reason = reasonOf(active);
  const shownTop = shown ? layout.tops[shown.id] : undefined;

  return <section aria-label="AI 修改建议" tabIndex={0} onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col outline-none">
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-paper p-2">
      <span className="text-xs font-medium">AI 修改建议</span>
      <Button size="icon-xs" variant="ghost" aria-label="上一处" title="上一处（K）" disabled={pending.length < 2} onClick={() => go(-1)}><ChevronUp /></Button>
      <span role="status" className="text-xs tabular-nums text-ink-muted">第 {Math.max(index, 0) + 1} / {pending.length} 处</span>
      <Button size="icon-xs" variant="ghost" aria-label="下一处" title="下一处（J）" disabled={pending.length < 2} onClick={() => go(1)}><ChevronDown /></Button>
      <div className="ml-auto flex items-center gap-1">
        <div className="mr-1 flex overflow-hidden rounded border border-line text-xs" role="group" aria-label="查看方式">
          {(['inline', 'split'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`px-2 py-0.5 ${mode === value ? 'bg-paper-inset font-medium' : 'text-ink-muted'}`}>{value === 'inline' ? '内联' : '对照'}</button>)}
        </div>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, allIds, 'reject')}>全部拒绝</Button>
        <Button size="xs" disabled={busy || review.stale} onClick={() => decide(review, allIds, 'accept')}>全部接受</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-1.5 text-xs text-ink-muted">
      {active ? <span className="min-w-0 max-w-full truncate text-ink" title={active.label}>
        <span className="mr-1.5 inline-block rounded px-1 text-[10px] text-paper" style={{ background: KIND_COLOR[kinds[active.id] ?? 'replace'] }}>{KIND_LABEL[kinds[active.id] ?? 'replace']}</span>{active.label}{active.editedByUserAt ? ' · 已由你编辑' : ''}
      </span> : null}
      {reason && <span className="min-w-0 max-w-full truncate" title={reason}>AI：{reason}</span>}
      <span className="ml-auto hidden shrink-0 sm:inline" title="在文档区域点击后可用">{counts.map(([kind, n]) => `${KIND_LABEL[kind]} ${n}`).join(' · ')}{counts.length ? ' · ' : ''}J/K 切换 · Enter 接受 · ⌫ 拒绝</span>
    </div>
    {review.stale && <Alert><AlertDescription>原文已更新，这批建议已过期。请基于最新内容重新生成建议；仍可拒绝。</AlertDescription></Alert>}
    {otherBatches > 0 && <p className="px-3 pt-2 text-xs text-ink-muted">另有 {otherBatches} 批建议等待审核，处理完这一批后显示。</p>}
    {failed ? <Alert variant="destructive"><AlertDescription>无法显示修改预览，请重新读取文档。</AlertDescription></Alert> : null}
    <div className="flex min-h-0 flex-1">
      <div ref={wrapper} className="relative min-h-0 flex-1 overflow-auto" onClick={onPick} onMouseOver={onHover} onMouseLeave={() => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHoverId(undefined), 350); }}>
        {mode === 'inline'
          ? <div ref={inlineHost} style={style} className="document-prose document-review py-5 pl-6 pr-28" aria-label="带修改标记的文档" />
          : <div className="grid grid-cols-2 divide-x divide-line">
            <div><p className="px-6 pt-3 text-xs text-ink-muted">修改前</p><div ref={beforeHost} style={style} className="document-prose document-review rv-before px-6 pb-5" /></div>
            <div><p className="px-6 pt-3 text-xs text-ink-muted">修改后</p><div ref={afterHost} style={style} className="document-prose document-review rv-after px-6 pb-5" /></div>
          </div>}
        {/* Fixed gutter beside the changed line: the buttons never sit on top of the text being judged. */}
        {shown && mode === 'inline' && shownTop !== undefined && <div data-rv-toolbar className="absolute right-2 z-10 flex items-center gap-0.5 rounded-md border border-line bg-paper p-0.5 shadow-sm" style={{ top: Math.max(0, shownTop - 4) }}>
          {editable && <Button size="icon-xs" variant="ghost" aria-label="编辑此处" title="编辑这处的文字" disabled={busy || review.stale} onClick={() => { setActiveId(shown.id); setEditing(shown.id); setDraft((shown.operation as Extract<DocumentEdit, { op: 'replaceText' }>).text); }}><Pencil /></Button>}
          <Button size="icon-xs" variant="ghost" aria-label="拒绝此处" title="拒绝（⌫）" disabled={busy} onClick={() => act([shown.id], 'reject')}><X /></Button>
          <Button size="icon-xs" aria-label="接受此处" title="接受（Enter）" disabled={busy || review.stale || editing === shown.id} onClick={() => act([shown.id], 'accept')}><Check /></Button>
        </div>}
        {shown && mode === 'inline' && editing === shown.id && shownTop !== undefined && <div className="absolute left-6 right-28 z-10 flex flex-col gap-2 rounded-lg border border-line bg-paper p-2 shadow-md" style={{ top: shownTop + 26 }}>
          <label htmlFor={`suggestion-${shown.id}`} className="text-xs">修改后的文字</label>
          <textarea id={`suggestion-${shown.id}`} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} className="min-h-16 w-full rounded border border-line bg-paper p-2 text-sm" />
          <div className="flex justify-end gap-2"><Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button size="xs" disabled={busy || review.stale} onClick={() => { void revise(review, shown, draft).then((saved) => { if (saved) setEditing(null); }); }}>保存</Button></div>
        </div>}
        {active && mode === 'split' && <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-paper p-2">
          <span className="min-w-0 flex-1 truncate text-xs" title={active.label}>{active.label}</span>
          <Button size="xs" variant="outline" aria-label="拒绝此处" disabled={busy} onClick={() => act([active.id], 'reject')}><X data-icon="inline-start" />拒绝此处</Button>
          <Button size="xs" aria-label="接受此处" disabled={busy || review.stale} onClick={() => act([active.id], 'accept')}><Check data-icon="inline-start" />接受此处</Button>
        </div>}
        {/* Room below the last paragraph so the final change can scroll to the middle. */}
        {mode === 'inline' && <div className="h-24" aria-hidden />}
      </div>
      {/* Overview rail: one tick per change at its position in the document; click to jump. */}
      <div className="relative w-3 shrink-0 border-l border-line bg-paper-inset" role="group" aria-label="修改位置">
        {layout.height > 0 && sorted.map((id, n) => layout.tops[id] === undefined ? null : <button key={id} type="button" aria-label={`跳到第 ${n + 1} 处`} title={`第 ${n + 1} 处`}
          onClick={() => { setActiveId(id); reveal(id); }}
          className="absolute left-0.5 right-0.5 -translate-y-1/2 rounded-sm"
          style={{ top: `${Math.min(99, (layout.tops[id] / layout.height) * 100)}%`, height: id === active?.id ? 8 : 5, background: KIND_COLOR[kinds[id] ?? 'replace'], opacity: id === active?.id ? 1 : 0.6 }} />)}
      </div>
    </div>
  </section>;
}

export function ReviewLog({ reviews }: { reviews: ArtifactReview[] }) {
  const done = reviews.flatMap((r) => r.changes.filter((c) => c.status !== 'pending'));
  if (!done.length) return null;
  return <details className="border-t border-line px-3 py-2"><summary className="cursor-pointer text-xs text-ink-muted">审核记录（{done.length}）</summary>
    {done.map((c) => <p className="mt-1 text-xs" key={c.id}>{c.label} · {c.status === 'accepted' ? `已接受 · 版本 ${c.acceptedVersion}` : '已拒绝'}</p>)}
  </details>;
}

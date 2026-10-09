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
const CHANGE_SELECTOR = 'ins[data-id], del[data-id], [data-type="modification"][data-id]';

function changeIdOf(element: Element): string | null {
  try { const value = JSON.parse(element.getAttribute('data-id') ?? 'null'); return typeof value === 'string' ? value : null; } catch { return null; }
}

/** Document-order list of change ids found in rendered review markup. */
function orderedIds(host: HTMLElement | null): string[] {
  const seen: string[] = [];
  host?.querySelectorAll(CHANGE_SELECTOR).forEach((element) => { const id = changeIdOf(element); if (id && !seen.includes(id)) seen.push(id); });
  return seen;
}

function markActive(host: HTMLElement | null, activeId: string | undefined) {
  host?.querySelectorAll('.rv-active').forEach((element) => element.classList.remove('rv-active'));
  if (!host || !activeId) return;
  host.querySelectorAll(CHANGE_SELECTOR).forEach((element) => { if (changeIdOf(element) === activeId) element.classList.add('rv-active'); });
}

function firstElement(host: HTMLElement | null, id: string | undefined): Element | null {
  if (!host || !id) return null;
  for (const element of Array.from(host.querySelectorAll(CHANGE_SELECTOR))) if (changeIdOf(element) === id) return element;
  return null;
}

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
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [cardTop, setCardTop] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const inlineHost = useRef<HTMLDivElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null);
  const afterHost = useRef<HTMLDivElement>(null);
  const pending = useMemo(() => review.changes.filter((c) => c.status === 'pending'), [review.changes]);
  const content = useMemo(() => parseDocumentContent(review.baseContent), [review.baseContent]);
  const style = useMemo(() => cssToStyle(typographyCss(content)), [content]);
  const sorted = useMemo(() => [...order, ...pending.map((c) => c.id).filter((id) => !order.includes(id))].filter((id) => pending.some((c) => c.id === id)), [order, pending]);
  const active = pending.find((c) => c.id === activeId) ?? pending.find((c) => c.id === sorted[0]);
  const index = active ? sorted.indexOf(active.id) : -1;

  // Render the projected document (base + suggestion marks) into the visible host(s).
  useEffect(() => {
    setFailed(false);
    const hosts = (mode === 'inline' ? [inlineHost.current] : [beforeHost.current, afterHost.current]).filter((h): h is HTMLDivElement => Boolean(h));
    if (!content) { setFailed(true); return; }
    try {
      const projected = documentReviewSchema.nodeFromJSON(reviewDocumentEdits(content, pending.map((c) => ({ edit: c.operation as DocumentEdit, changeId: c.id }))));
      const serializer = DOMSerializer.fromSchema(documentReviewSchema);
      for (const host of hosts) host.replaceChildren(serializer.serializeFragment(projected.content));
      setOrder(orderedIds(hosts[0]));
    } catch { setFailed(true); }
  }, [content, pending, mode]);

  const place = useCallback(() => {
    const host = mode === 'inline' ? inlineHost.current : afterHost.current;
    const target = firstElement(host, active?.id);
    if (!target || !wrapper.current || mode !== 'inline') { setCardTop(null); return; }
    setCardTop(target.getBoundingClientRect().bottom - wrapper.current.getBoundingClientRect().top + 6);
  }, [active?.id, mode]);

  useEffect(() => {
    for (const host of [inlineHost.current, beforeHost.current, afterHost.current]) markActive(host, active?.id);
    place();
  }, [active?.id, order, mode, place]);
  useEffect(() => {
    const observer = new ResizeObserver(() => place());
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [place]);
  useEffect(() => { setEditing(null); }, [active?.id]);

  function go(delta: number) {
    if (!sorted.length) return;
    const next = sorted[(Math.max(index, 0) + delta + sorted.length) % sorted.length];
    setActiveId(next);
    for (const host of [mode === 'inline' ? inlineHost.current : afterHost.current, beforeHost.current]) firstElement(host, next)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const onPick = (event: React.MouseEvent) => {
    const hit = (event.target as Element).closest(CHANGE_SELECTOR);
    if ((event.target as Element).closest('a')) event.preventDefault();
    const id = hit ? changeIdOf(hit) : null;
    if (id) setActiveId(id);
  };
  const act = (ids: string[], decision: 'accept' | 'reject') => {
    // Land on the neighbouring change once this one is resolved.
    const nextId = sorted[index + 1] ?? sorted[index - 1];
    setActiveId(nextId); decide(review, ids, decision);
  };
  const allIds = pending.map((c) => c.id);
  const editable = active && (active.operation as DocumentEdit).op === 'replaceText';

  return <section aria-label="AI 修改建议" className="flex min-h-0 flex-1 flex-col">
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-paper p-2">
      <span className="text-xs font-medium">AI 修改建议</span>
      <Button size="icon-xs" variant="ghost" aria-label="上一处" disabled={pending.length < 2} onClick={() => go(-1)}><ChevronUp /></Button>
      <span role="status" className="text-xs tabular-nums text-ink-muted">第 {Math.max(index, 0) + 1} / {pending.length} 处</span>
      <Button size="icon-xs" variant="ghost" aria-label="下一处" disabled={pending.length < 2} onClick={() => go(1)}><ChevronDown /></Button>
      <div className="ml-auto flex items-center gap-1">
        <div className="mr-1 flex overflow-hidden rounded border border-line text-xs" role="group" aria-label="查看方式">
          {(['inline', 'split'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`px-2 py-0.5 ${mode === value ? 'bg-paper-inset font-medium' : 'text-ink-muted'}`}>{value === 'inline' ? '内联' : '对照'}</button>)}
        </div>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, allIds, 'reject')}>全部拒绝</Button>
        <Button size="xs" disabled={busy || review.stale} onClick={() => decide(review, allIds, 'accept')}>全部接受</Button>
      </div>
    </div>
    {review.stale && <Alert><AlertDescription>原文已更新，这批建议已过期。请基于最新内容重新生成建议；仍可拒绝。</AlertDescription></Alert>}
    {otherBatches > 0 && <p className="px-3 pt-2 text-xs text-ink-muted">另有 {otherBatches} 批建议等待审核，处理完这一批后显示。</p>}
    {failed ? <Alert variant="destructive"><AlertDescription>无法显示修改预览，请重新读取文档。{active ? <span className="mt-1 block text-xs">{active.label}</span> : null}</AlertDescription></Alert> : null}
    <div ref={wrapper} className="relative min-h-0 flex-1 overflow-auto" onClick={onPick}>
      {mode === 'inline'
        ? <div ref={inlineHost} style={style} className="document-prose document-review px-6 py-5" aria-label="带修改标记的文档" />
        : <div className="grid grid-cols-2 divide-x divide-line">
          <div><p className="px-6 pt-3 text-xs text-ink-muted">修改前</p><div ref={beforeHost} style={style} className="document-prose document-review rv-before px-6 pb-5" /></div>
          <div><p className="px-6 pt-3 text-xs text-ink-muted">修改后</p><div ref={afterHost} style={style} className="document-prose document-review rv-after px-6 pb-5" /></div>
        </div>}
      {active && mode === 'inline' && cardTop !== null && <div className="absolute left-6 right-6 z-10 rounded-lg border border-line bg-paper p-2 shadow-md" style={{ top: cardTop }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs" title={active.label}>{active.label}{active.editedByUserAt ? ' · 已由你编辑' : ''}</span>
          {editable && <Button size="xs" variant="ghost" disabled={busy || review.stale} onClick={() => { setEditing(active.id); setDraft((active.operation as Extract<DocumentEdit, { op: 'replaceText' }>).text); }}><Pencil data-icon="inline-start" />编辑</Button>}
          <Button size="xs" variant="outline" disabled={busy} onClick={() => act([active.id], 'reject')}><X data-icon="inline-start" />拒绝</Button>
          <Button size="xs" disabled={busy || review.stale || editing === active.id} onClick={() => act([active.id], 'accept')}><Check data-icon="inline-start" />接受</Button>
        </div>
        {editing === active.id && <div className="mt-2 flex flex-col gap-2">
          <label htmlFor={`suggestion-${active.id}`} className="text-xs">修改后的文字</label>
          <textarea id={`suggestion-${active.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} className="min-h-16 w-full rounded border border-line bg-paper p-2 text-sm" />
          <div className="flex justify-end gap-2"><Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button size="xs" disabled={busy || review.stale} onClick={() => { void revise(review, active, draft).then((saved) => { if (saved) setEditing(null); }); }}>保存</Button></div>
        </div>}
      </div>}
      {active && mode === 'split' && <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-paper p-2">
        <span className="min-w-0 flex-1 truncate text-xs" title={active.label}>{active.label}</span>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => act([active.id], 'reject')}><X data-icon="inline-start" />拒绝此处</Button>
        <Button size="xs" disabled={busy || review.stale} onClick={() => act([active.id], 'accept')}><Check data-icon="inline-start" />接受此处</Button>
      </div>}
      {/* Spacer so the floating card never covers the last paragraph. */}
      {mode === 'inline' && <div className="h-28" aria-hidden />}
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

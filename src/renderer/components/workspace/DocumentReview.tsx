import { documentReviewSchema, reviewDocumentEdit } from '../../../shared/documentReview';
import { useEffect, useRef, useState } from 'react';
import { DOMSerializer } from '@tiptap/pm/model';
import { applyDocumentEdit, documentSchema, parseDocumentContent, type DocumentEdit } from '../../../shared/documentContent';
import type { ArtifactReview, ArtifactReviewChange } from '../../../shared/artifactReview';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

function RichChange({ review, change }: { review: ArtifactReview; change: ArtifactReviewChange }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const root = host.current; root.replaceChildren();
    const content = parseDocumentContent(review.baseContent);
    if (!content) { root.textContent = '无法显示预览，请重新读取文档'; return; }
    try {
      const operation = change.operation as DocumentEdit;
      if (operation.op === 'replaceText') {
        const node = documentReviewSchema.nodeFromJSON(reviewDocumentEdit(content, operation, change.id));
        const fragment = DOMSerializer.fromSchema(documentReviewSchema).serializeFragment(node.content);
        // Keep only the changed top-level block, including its rich-text context.
        root.append(fragment);
        for (const child of Array.from(root.children)) if (!child.matches('ins, del, [data-type="modification"]') && !child.querySelector('ins, del, [data-type="modification"]')) child.remove();
      } else {
        for (const [label, doc] of [['修改前', content], ['修改后', applyDocumentEdit(content, operation)]] as const) {
          const heading = document.createElement('p'); heading.textContent = label; heading.className = 'text-xs text-ink-muted'; root.append(heading);
          const body = document.createElement('div'); body.className = 'rounded border border-line p-3';
          body.append(DOMSerializer.fromSchema(documentSchema).serializeFragment(documentSchema.nodeFromJSON(doc.doc).content)); root.append(body);
        }
      }
    } catch { root.textContent = `修改前：${change.before}\n修改后：${change.after}`; }
  }, [review.baseContent, change]);
  return <div ref={host} className="document-prose document-review flex flex-col gap-3 text-sm" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }} />;
}

export default function DocumentReview({ reviews, busy, decide, revise }: { reviews: ArtifactReview[]; busy: boolean; decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject'): void; revise(review: ArtifactReview, change: ArtifactReviewChange, text: string): Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState('');
  const pending = reviews.filter((r) => r.changes.some((c) => c.status === 'pending'));
  return <section aria-label="AI 修改建议" className="flex flex-col gap-3 border-t border-line p-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">AI 修改建议</h3><span className="text-xs text-ink-muted">接受后才会更新原文</span></div>
    {!pending.length && <p className="text-xs text-ink-muted">暂无待审核修改。选中文字后，可在对话中让 AI 提出修改建议。</p>}
    {pending.map((review) => <div key={review.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
      {review.stale && <Alert><AlertDescription>原文已更新，这批建议已过期。请基于最新内容重新生成建议。</AlertDescription></Alert>}
      <div className="flex items-center gap-2"><span className="mr-auto text-xs text-ink-muted">基于版本 {review.baseVersion} · {review.changes.filter((c) => c.status === 'pending').length} 项待审核</span>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'reject')}>全部拒绝</Button>
        <Button size="xs" disabled={busy || review.stale || review.changes.some((c) => c.id === editing)} onClick={() => decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'accept')}>全部接受</Button>
      </div>
      {review.changes.filter((c) => c.status === 'pending').map((change) => <details key={change.id} open className="rounded border border-line p-2">
        <summary className="cursor-pointer text-sm">{change.label}{change.editedByUserAt ? ' · 已由你编辑' : ''}</summary>
        <div className="my-3 max-h-96 overflow-auto"><RichChange review={review} change={change} /></div>
        {editing === change.id && <div className="my-2 flex flex-col gap-2"><label htmlFor={`suggestion-${change.id}`} className="text-xs">修改建议文字</label><textarea id={`suggestion-${change.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} className="min-h-24 w-full rounded border border-line bg-paper p-2 text-sm" /><div className="flex justify-end gap-2"><Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button size="xs" disabled={busy || review.stale} onClick={() => { void revise(review, change, draft).then((saved) => { if (saved) setEditing(null); }); }}>保存建议</Button></div></div>}
        <div className="flex justify-end gap-2">{(change.operation as DocumentEdit).op === 'replaceText' && <Button size="xs" variant="ghost" disabled={busy || review.stale} onClick={() => { setEditing(change.id); setDraft((change.operation as Extract<DocumentEdit, { op: 'replaceText' }>).text); }}>编辑建议</Button>}<Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, [change.id], 'reject')}>拒绝</Button><Button size="xs" disabled={busy || review.stale || editing === change.id} onClick={() => decide(review, [change.id], 'accept')}>接受</Button></div>
      </details>)}
    </div>)}
    {reviews.some((r) => r.changes.some((c) => c.status !== 'pending')) && <details><summary className="cursor-pointer text-xs text-ink-muted">审核记录</summary>{reviews.flatMap((r) => r.changes.filter((c) => c.status !== 'pending').map((c) => <p className="mt-2 text-xs" key={c.id}>{c.label} · {c.status === 'accepted' ? `已接受 · 版本 ${c.acceptedVersion}` : '已拒绝'}</p>))}</details>}
  </section>;
}

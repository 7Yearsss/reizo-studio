import { useState } from 'react';
import type { ArtifactReview } from '../../../shared/artifactReview';
import { parsePresentation, type PresentationEdit } from '../../../shared/presentationContent';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import LazyDiffView from '../chat/LazyDiffView';
import PresentationSurface from './PresentationSurface';
import { ReviewLog } from './workspaceChrome';

function VisualReview({ review }: { review: ArtifactReview }) {
  const [open, setOpen] = useState(false);
  const before = open ? parsePresentation(review.baseContent) : null;
  const after = open ? parsePresentation(review.candidateContent) : null;
  const ids = [...new Set(review.changes.filter((c) => c.status === 'pending').map((c) => { const op = c.operation as PresentationEdit; return op.op === 'addSlide' ? op.slide.id : op.slideId; }))];
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-xs">查看修改前后页面</summary>{open && <div className="mt-2 flex flex-col gap-3">{ids.map((id) => <div key={id} className="flex flex-col gap-2">{[['修改前', before?.slides.find((s) => s.id === id)], ['修改后', after?.slides.find((s) => s.id === id)]].map(([label, value]) => <div key={String(label)}><p className="mb-1 text-xs text-ink-muted">{String(label)}</p>{typeof value === 'object' ? <PresentationSurface slide={value} /> : <p className="text-xs text-ink-muted">无此页面</p>}</div>)}</div>)}</div>}</details>;
}
export default function PresentationReview({ reviews, busy, decide }: { reviews: ArtifactReview[]; busy: boolean; decide(review: ArtifactReview, ids: string[], decision: 'accept' | 'reject'): void }) {
  const pending = reviews.filter((r) => r.changes.some((c) => c.status === 'pending'));
  return <section aria-label="PPT 修改建议" className="flex flex-col gap-3 border-t border-line p-3"><div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-sm font-medium">AI 修改建议{pending.length ? <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 text-paper tabular-nums">{pending.reduce((n, r) => n + r.changes.filter((c) => c.status === 'pending').length, 0)}</span> : null}</h3><span className="text-xs text-ink-muted">接受后才会更新演示稿</span></div>
    {!pending.length && <p className="text-xs text-ink-muted">暂无待审核修改。引用当前页或选中元素，在对话中提出修改要求。</p>}
    {pending.map((review) => <div key={review.id} className="flex flex-col gap-2 rounded border border-line p-3">
      {review.stale && <Alert><AlertDescription>演示稿已有新版本，请重新生成这批建议。</AlertDescription></Alert>}
      <div className="flex items-center gap-2"><span className="mr-auto text-xs text-ink-muted">基于版本 {review.baseVersion}</span><Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'reject')}>全部拒绝</Button><Button size="xs" disabled={busy || review.stale} onClick={() => decide(review, review.changes.filter((c) => c.status === 'pending').map((c) => c.id), 'accept')}>全部接受</Button></div>
      <VisualReview review={review} />
      {review.changes.filter((c) => c.status === 'pending').map((change) => <div key={change.id} className="flex flex-col gap-2 border-t border-line pt-2"><p className="text-sm">{change.label}</p><details><summary className="cursor-pointer text-xs text-ink-muted">查看元素属性变化</summary><LazyDiffView preview={{ path: 'element.json', before: change.before ? JSON.stringify(JSON.parse(change.before), null, 2) : '', after: change.after ? JSON.stringify(JSON.parse(change.after), null, 2) : '' }} /></details><div className="flex justify-end gap-2"><Button size="xs" variant="outline" disabled={busy} onClick={() => decide(review, [change.id], 'reject')}>拒绝</Button><Button size="xs" disabled={busy || review.stale} onClick={() => decide(review, [change.id], 'accept')}>接受</Button></div></div>)}
    </div>)}
    <ReviewLog reviews={reviews} />
  </section>;
}

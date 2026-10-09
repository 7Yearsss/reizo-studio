import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileSliders, ImageIcon, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { CanvasNode } from '../../../shared/canvas';
import { selectedAsset } from '../../../shared/canvasReferences';
import type { PresentationExportRequest } from '../../../shared/canvasPresentation';
import type { SavedDeliveryPlan } from '../../../shared/skillContract';
import { canvasAssetUrl, exportCanvasPresentation, listCanvasDeliveryPlans } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/field';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';

interface PageChoice { nodeId: string; assetId?: string; path: string; title: string }
export interface PresentationSubmission { jobId: string; nodeId: string; status: string }
interface Props { sessionId: string; selectedNodeIds?: string[]; onClose: () => void; onQueued: (submission: PresentationSubmission) => void }

// Keep an unknown submission replayable even if the user closes and reopens the dialog.
const pendingAttempts = new Map<string, { signature: string; id: string }>();

function choicesFor(nodes: CanvasNode[]): PageChoice[] {
  return nodes.flatMap((node) => {
    const path = selectedAsset(node);
    if (!path || !['image', 'anchor', 'frameExtractor'].includes(node.type)) return [];
    const assetId = node.output?.resultSet?.find((result) => result.asset === path)?.assetId
      ?? (node.type === 'anchor' ? (node.params as { assetId?: string }).assetId : undefined);
    return [{ nodeId: node.id, assetId, path, title: node.title || '图片页' }];
  });
}

function PageThumbnail({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; void canvasAssetUrl(path).then((value) => { if (live) setUrl(value); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [path]);
  return <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-paper-inset/30 text-ink-muted">
    {url && !failed ? <img src={url} alt="" className="size-full object-contain" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : <ImageIcon size={18} aria-hidden="true" />}
  </span>;
}

export default function PresentationExportModal({ sessionId, selectedNodeIds = [], onClose, onQueued }: Props) {
  const canvasId = useCanvasStore((state) => state.canvasIdBySession[sessionId]);
  const [choices] = useState(() => choicesFor(canvasStore.getSnapshot().nodesBySession[sessionId] ?? []));
  const [pages, setPages] = useState<PageChoice[]>(() => [...new Set(selectedNodeIds)].flatMap((id) => choices.filter((page) => page.nodeId === id)).slice(0, 40));
  const [title, setTitle] = useState('演示稿');
  const [planId, setPlanId] = useState('none');
  const [plans, setPlans] = useState<SavedDeliveryPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const scope = useRef(canvasId); scope.current = canvasId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!canvasId) { setPlansLoading(false); return; }
    let live = true; setPlansLoading(true);
    void listCanvasDeliveryPlans(canvasId).then((value) => {
      if (live) { setPlans(value.filter((plan) => plan.contract.requiredExports?.some((item) => item.format === 'pptx'))); setPlansError(''); }
    }).catch((reason) => { if (live) setPlansError(reason instanceof Error ? reason.message : '交付计划读取失败'); })
      .finally(() => { if (live) setPlansLoading(false); });
    return () => { live = false; };
  }, [canvasId, refresh]);

  const selectedPlan = plans.find((plan) => plan.id === planId);
  const planProblem = planId !== 'none' && (!selectedPlan ? '请重新选择可用的交付计划。'
    : selectedPlan.plan.input.pages !== pages.length ? `此交付计划要求 ${selectedPlan.plan.input.pages} 页，当前已选 ${pages.length} 页。`
      : pages.some((page) => !page.assetId) ? '关联交付计划需要每一页都有已登记的资源版本；这些图片仍可独立导出。' : '');
  const visibleChoices = choices.filter((page) => page.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  const submit = async () => {
    if (inFlight.current || !canvasId || !pages.length || planProblem) return;
    const request: PresentationExportRequest = { title: title.trim() || '演示稿', pages: pages.map(({ nodeId, assetId, path }) => ({ nodeId, ...(assetId ? { assetId } : {}), expectedPath: path })), ...(planId !== 'none' ? { planId } : {}) };
    const signature = JSON.stringify(request);
    let attempt = pendingAttempts.get(canvasId);
    if (attempt?.signature !== signature) {
      // Legacy images have no immutable asset ID. Refuse an unnoticed version switch before first admission.
      const changed = pages.find((page) => !page.assetId && selectedAsset(canvasStore.nodeById(sessionId, page.nodeId) ?? { output: null }) !== page.path);
      if (changed) { setError(`「${changed.title}」的选定图片已变化，请重新打开导出设置选择当前版本。`); return; }
      attempt = { signature, id: nanoid() }; pendingAttempts.set(canvasId, attempt);
    }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const submission = await exportCanvasPresentation(canvasId, request, attempt.id);
      if (pendingAttempts.get(canvasId)?.id === attempt.id) pendingAttempts.delete(canvasId);
      if (!mounted.current || scope.current !== canvasId) return;
      canvasStore.focusNode(sessionId, submission.nodeId);
      onQueued(submission); onClose();
    } catch (reason) {
      if (mounted.current && scope.current === canvasId) setError(reason instanceof Error ? reason.message : '导出请求未能确认，请重试同一选择。');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const move = (index: number, offset: number) => setPages((current) => {
    const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next;
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-32px)] max-w-[calc(100vw-24px)] flex-col gap-0 overflow-hidden p-0 text-ink sm:max-w-3xl"
      onEscapeKeyDown={(event) => { event.stopPropagation(); if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      onKeyDown={(event) => event.stopPropagation()}>
      <DialogHeader className="shrink-0 px-5 pb-4 pt-5"><div className="flex items-start justify-between gap-3"><DialogTitle className="flex items-center gap-2 text-base"><FileSliders size={18} aria-hidden="true" />导出演示稿</DialogTitle><Button type="button" variant="ghost" size="icon-xs" aria-label="关闭演示稿导出" disabled={busy} onClick={onClose}><X /></Button></div><DialogDescription>将现有图片按页序放入本地 PPTX，每图一页，保留已选版本，不重新生成图片。</DialogDescription></DialogHeader>
      <Separator />
      <div className="min-h-0 overflow-y-auto px-5 py-4">
        <FieldGroup className="gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field data-disabled={busy}><FieldLabel htmlFor="presentation-export-title">演示稿标题</FieldLabel><Input id="presentation-export-title" maxLength={160} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></Field><Field data-disabled={busy || plansLoading}><FieldLabel htmlFor="presentation-export-plan">关联交付计划 · 可选</FieldLabel><Select value={planId} disabled={busy || plansLoading} onValueChange={setPlanId}><SelectTrigger id="presentation-export-plan" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">独立导出</SelectItem>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{String(plan.plan.input.title || plan.plan.input.topic || plan.skillId)} · {String(plan.plan.input.pages)} 页</SelectItem>)}</SelectGroup></SelectContent></Select>{plansLoading ? <FieldDescription>正在读取交付计划…</FieldDescription> : !plans.length && !plansError ? <FieldDescription>当前画布暂无演示稿交付计划。</FieldDescription> : null}</Field></div>
          {plansError ? <Alert variant="destructive"><AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{plansError}<Button type="button" variant="ghost" size="xs" disabled={plansLoading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw data-icon="inline-start" />重新读取计划</Button></AlertDescription></Alert> : null}
          {planProblem ? <Alert><AlertDescription>{planProblem}</AlertDescription></Alert> : null}
        </FieldGroup>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <section aria-label="演示稿页序" className="min-w-0"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">页序</h3><span className="text-xs tabular-nums text-ink-muted">{pages.length} / 40 页</span></div>
            {pages.length ? <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-1">{pages.map((page, index) => <li key={page.nodeId} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-paper-inset/30 focus-within:bg-paper-inset/30"><span className="w-4 shrink-0 text-center text-xs tabular-nums text-ink-muted">{index + 1}</span><PageThumbnail path={page.path} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={page.title}>{page.title}</p><p className="mt-1 text-[11px] text-ink-muted">{page.assetId ? '固定资源版本' : '当前图片快照'}</p></div><div className="flex shrink-0 flex-col gap-1"><Button type="button" variant="ghost" size="icon-xs" aria-label={`将第${index + 1}页上移`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label={`将第${index + 1}页下移`} disabled={busy || index === pages.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button></div><Button type="button" variant="ghost" size="icon-xs" aria-label={`移除第${index + 1}页${page.title}`} disabled={busy} onClick={() => setPages((current) => current.filter((item) => item.nodeId !== page.nodeId))}><X /></Button></li>)}</ol> : <p className="rounded-lg border border-dashed border-line px-4 py-7 text-center text-xs leading-relaxed text-ink-muted">从可用图片中选择页面，或先在画布上选中图片再打开导出。</p>}
          </section>
          <section aria-label="选择已有图片" className="min-w-0"><h3 className="mb-2 text-sm font-medium">可用图片</h3><Field><FieldLabel className="sr-only" htmlFor="presentation-export-search">搜索图片</FieldLabel><Input id="presentation-export-search" type="search" placeholder="搜索图片名称" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></Field><div className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">{visibleChoices.map((page) => {
            const checked = pages.some((item) => item.nodeId === page.nodeId);
            return <label key={page.nodeId} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-paper-inset/30 focus-within:bg-paper-inset/30"><Checkbox checked={checked} disabled={busy || !checked && pages.length >= 40} aria-label={`选择${page.title}作为演示稿页面`} onCheckedChange={(value) => { setError(''); setPages((current) => value === true ? current.length >= 40 || current.some((item) => item.nodeId === page.nodeId) ? current : [...current, page] : current.filter((item) => item.nodeId !== page.nodeId)); }} /><PageThumbnail path={page.path} /><span className="min-w-0 truncate text-xs" title={page.title}>{page.title}</span></label>;
          })}{!visibleChoices.length ? <p className="px-2 py-5 text-xs leading-relaxed text-ink-muted">{choices.length ? '没有匹配的图片。' : '当前画布还没有可导出的图片产物。'}</p> : null}</div></section>
        </div>
        {error ? <Alert variant="destructive" className="mt-4"><AlertTitle>导出请求未确认</AlertTitle><AlertDescription className="min-w-0 max-h-28 overflow-y-auto [overflow-wrap:anywhere]">{error}<p>保留相同选择重试可查询原请求，不会重复创建任务。</p></AlertDescription></Alert> : null}
      </div>
      <Separator /><footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4"><span className="text-xs text-ink-muted" role="status">{busy ? '正在接收本地导出任务…' : '完成后可在导出节点下载固定版本文件。'}</span><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button><Button type="button" size="sm" disabled={busy || !canvasId || !pages.length || Boolean(planProblem)} onClick={() => void submit()}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <FileSliders data-icon="inline-start" />}{busy ? '提交中' : error ? '重试本地导出' : '生成 PPTX'}</Button></div></footer>
    </DialogContent>
  </Dialog>;
}

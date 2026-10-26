import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@xyflow/react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, CircleSlash2, Clock, LoaderCircle, LocateFixed, PauseCircle, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { CanvasJobPage, CanvasJobStatus, CanvasJobSummary } from '../../../shared/canvasJobs';
import { isPresentationExportNode } from '../../../shared/canvasPresentation';
import { cancelCanvasJob, listCanvasJobs, retryCanvasJob } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyContent, EmptyTitle, EmptyDescription } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { Separator } from '../ui/separator';
import { Field, FieldGroup, FieldLabel } from '../ui/field';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';
import CanvasUtilityPanel from './CanvasUtilityPanel';
import useCanvasLayer from './useCanvasLayer';
import JobUsageDetails from './JobUsageDetails';

const labels: Record<CanvasJobStatus, string> = { queued: '排队中', running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const reasons: Record<string, string> = { superseded: '已被新任务替代', user_cancelled: '手动取消', host_shutdown: '应用退出', restart: '应用重启', shutdown: '应用退出' };

function groupByDay(jobs: CanvasJobSummary[]) {
  const groups = new Map<string, { label: string; jobs: CanvasJobSummary[] }>();
  const today = new Date().toLocaleDateString('zh-CN');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString('zh-CN');
  for (const job of jobs) {
    const date = new Date(job.createdAt);
    const key = Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleDateString('zh-CN');
    const label = key === today ? '今天' : key === yesterdayKey ? '昨天' : key === 'unknown' ? '较早的任务' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    const group = groups.get(key) ?? { label, jobs: [] };
    group.jobs.push(job); groups.set(key, group);
  }
  return [...groups.entries()];
}

function JobRow({ job, sessionId, busy, confirming, onConfirm, onDismiss, onAction }: {
  job: CanvasJobSummary; sessionId: string; busy: string; confirming: boolean;
  onConfirm: () => void; onDismiss: () => void; onAction: (retry: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const retryRef = useRef<HTMLButtonElement>(null);
  const dismiss = () => { onDismiss(); requestAnimationFrame(() => retryRef.current?.focus()); };
  const isActive = job.status === 'queued' || job.status === 'running';
  const needsAttention = job.status === 'failed' || job.status === 'interrupted';
  const StatusIcon = job.status === 'running' ? LoaderCircle : job.status === 'succeeded' ? CheckCircle2 : job.status === 'failed' ? AlertCircle : job.status === 'interrupted' ? PauseCircle : job.status === 'cancelled' ? CircleSlash2 : Clock;
  const reason = job.error || reasons[job.cancelReason] || job.cancelReason;
  const date = new Date(job.createdAt);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const canRetry = job.isCurrent && job.nodeExists && ['failed', 'interrupted', 'cancelled'].includes(job.status);
  const localExport = isPresentationExportNode(canvasStore.nodeById(sessionId, job.nodeId)) || job.providerId === 'local' && job.model === 'pptxgenjs-4.0.1';
  const title = job.nodeTitle || job.nodeType;
  return <article aria-label={`${title}，${labels[job.status]}`} aria-busy={busy === job.id} className={cn(
    'group rounded-xl p-3 transition-colors hover:bg-paper-inset/25 focus-within:bg-paper-inset/25 motion-reduce:transition-none',
    confirming && canRetry && 'bg-paper-inset/30')}
    onKeyDown={(event) => { if (event.key === 'Escape' && confirming && !busy) { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <div className="flex items-start justify-between gap-2">
      <button type="button" disabled={!job.nodeExists} onClick={() => canvasStore.focusNode(sessionId, job.nodeId)} className="min-w-0 truncate rounded text-left text-[12px] font-medium text-ink outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring disabled:text-ink-muted" title={job.nodeTitle || job.nodeId} aria-label={`定位到${title}`}>{title}</button>
      <span className={cn('flex shrink-0 items-center gap-1 text-[11px]', needsAttention ? 'text-danger' : job.status === 'succeeded' ? 'text-success' : 'text-ink-muted')}><StatusIcon size={12} className={cn(job.status === 'running' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{labels[job.status]}</span>
    </div>
    <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-ink-muted"><span className="truncate" title={job.model}>{job.model || (localExport ? 'PPTX · 等待本地执行' : '模型未知')}</span><time className="shrink-0 tabular-nums" dateTime={Number.isNaN(date.getTime()) ? undefined : job.createdAt}>{time}</time></div>
    <p className="mt-1 truncate text-[10px] text-ink-muted" title={job.providerId}>{localExport ? '本地导出，无生成调用' : `供应商：${job.providerId || '未知'}`}</p>
    {reason ? <p className={cn('mt-2 text-[11px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]', !expanded && 'line-clamp-2')}>{reason}</p> : null}
    {!job.nodeExists ? <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">原节点已删除，生成产物仍可从素材库复用。</p> : null}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-ink-muted">第 {job.generation} 次执行</span>
        <Button type="button" variant="ghost" size="xs" aria-expanded={usageOpen} onClick={() => setUsageOpen((value) => !value)}>{usageOpen ? '收起用量' : '用量与费用'}</Button>
        {reason && reason.length > 75 ? <Button type="button" variant="ghost" size="xs" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起原因' : '展开原因'}</Button> : null}
      </div>
      <div className="flex items-center gap-1">
        {job.nodeExists ? <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"><Tooltip content="定位到原节点"><Button type="button" variant="ghost" size="icon-xs" aria-label={`定位到${title}的原节点`} onClick={() => canvasStore.focusNode(sessionId, job.nodeId)}><LocateFixed /></Button></Tooltip></div> : null}
        {job.isCurrent && isActive ? <Button type="button" variant="ghost" size="xs" disabled={Boolean(busy)} onClick={() => onAction(false)}>{busy === job.id ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Square data-icon="inline-start" />}{busy === job.id ? '取消中' : '取消任务'}</Button> : null}
        {canRetry && !confirming ? <Button ref={retryRef} type="button" variant="outline" size="xs" disabled={Boolean(busy)} onClick={() => localExport ? onAction(true) : onConfirm()}><RotateCcw data-icon="inline-start" />{localExport ? '本地重试' : '重试'}</Button> : null}
      </div>
    </div>
    {usageOpen ? <JobUsageDetails jobId={job.id} status={job.status} /> : null}
    {confirming && canRetry ? <div className="mt-3 flex flex-col gap-2">
      <Separator />
      <p className="text-[11px] leading-relaxed text-ink-muted">按当前节点设置创建新任务，生成可能产生费用。</p>
      <div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="xs" disabled={Boolean(busy)} onClick={dismiss} autoFocus><X data-icon="inline-start" />取消</Button><Button type="button" size="xs" disabled={Boolean(busy)} onClick={() => onAction(true)}>{busy === job.id ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <RotateCcw data-icon="inline-start" />}{busy === job.id ? '提交中' : '确认重试'}</Button></div>
    </div> : null}
  </article>;
}

export default function CanvasJobsPanel({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const canvasId = useCanvasStore((state) => state.canvasIdBySession[sessionId]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<CanvasJobPage>({ jobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const scope = useRef(canvasId); scope.current = canvasId;
  const retries = useRef(new Map<string, string>());
  const actionInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupByDay(page.jobs), [page.jobs]);

  useEffect(() => { setCursors([]); setPage({ jobs: [] }); setConfirm(''); setError(''); }, [canvasId, status, search]);
  useEffect(() => { setActionError(''); }, [canvasId]);
  useEffect(() => { if (!open) setConfirm(''); }, [open]);
  useEffect(() => {
    if (!open || !canvasId) return;
    const abort = new AbortController();
    let sequence = 0;
    setLoading(true);
    const read = async () => {
      const attempt = ++sequence;
      try {
        const response = await listCanvasJobs(canvasId, { status, search, cursor: cursors.at(-1), signal: abort.signal });
        if (abort.signal.aborted || attempt !== sequence) return;
        setPage(response); setError('');
      } catch (error) {
        if (!abort.signal.aborted && attempt === sequence) setError(error instanceof Error ? error.message : '任务历史读取失败');
      } finally { if (!abort.signal.aborted && attempt === sequence) setLoading(false); }
    };
    const initial = setTimeout(() => void read(), 180);
    const poll = setInterval(() => { if (document.visibilityState !== 'hidden') void read(); }, 3000);
    return () => { abort.abort(); clearTimeout(initial); clearInterval(poll); };
  }, [open, canvasId, status, search, cursors, refresh]);

  const act = async (job: CanvasJobSummary, retry: boolean) => {
    if (actionInFlight.current || !canvasId) return;
    actionInFlight.current = true; setBusy(job.id); setActionError('');
    try {
      if (retry) {
        let id = retries.current.get(job.id);
        if (!id) { id = `retry:${job.id}:${nanoid()}`; retries.current.set(job.id, id); }
        await retryCanvasJob(canvasId, job.id, id);
        retries.current.delete(job.id);
      } else await cancelCanvasJob(canvasId, job.id);
      if (scope.current === canvasId) { setConfirm(''); setCursors([]); setRefresh((value) => value + 1); }
    } catch (error) {
      if (scope.current === canvasId) setActionError(error instanceof Error ? error.message : '操作未完成');
    } finally { actionInFlight.current = false; setBusy(''); }
  };

  const layer = useCanvasLayer(open);
  if (!open) return null;
  return <Panel position="top-left" className="!m-3 !ml-[60px]" style={{ zIndex: layer.zIndex }} onPointerDownCapture={layer.raise}>
    <CanvasUtilityPanel title="任务历史" icon={Clock} description="当前画布的执行记录" onClose={() => { setConfirm(''); onClose(); }}
      actions={<Tooltip content="刷新任务历史"><Button type="button" variant="ghost" size="icon-xs" aria-label="刷新任务历史" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button></Tooltip>}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); if (confirm && !busy) setConfirm(''); else if (!confirm) onClose(); } }}>
      <div className="shrink-0 px-4 pb-3 pt-2">
        <Tabs value={status} onValueChange={setStatus}><TabsList variant="line" className="w-full"><TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="active">进行中</TabsTrigger><TabsTrigger value="attention">需处理</TabsTrigger></TabsList></Tabs>
        <FieldGroup className="mt-3"><Field><FieldLabel className="sr-only" htmlFor={`job-search-${sessionId}`}>搜索任务</FieldLabel><Input ref={searchRef} id={`job-search-${sessionId}`} type="search" placeholder="搜索节点、模型或失败原因" value={search} onChange={(event) => setSearch(event.target.value)} /></Field></FieldGroup>
      </div>
      <Separator />
      <div className="min-h-0 overflow-y-auto px-2 pb-3" aria-busy={loading}>
        {actionError ? <div className="px-1 pt-3"><Alert variant="destructive"><AlertTitle>任务操作未完成</AlertTitle><AlertDescription className="min-w-0 max-h-28 overflow-y-auto [overflow-wrap:anywhere]">{actionError}<Button type="button" variant="ghost" size="xs" onClick={() => setActionError('')}>知道了</Button></AlertDescription></Alert></div> : null}
        {error ? <div className="px-1 pt-3"><Alert variant="destructive"><AlertTitle>任务历史未能更新</AlertTitle><AlertDescription className="min-w-0 max-h-28 overflow-y-auto [overflow-wrap:anywhere]">{error}<Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}>重新读取</Button></AlertDescription></Alert></div> : null}
        {loading && !page.jobs.length ? <div className="flex flex-col gap-4 px-2 py-4" role="status" aria-label="正在加载任务历史">{[0, 1, 2].map((item) => <div key={item} className="flex flex-col gap-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-1/2" /></div>)}</div>
          : page.jobs.length ? groups.map(([key, group]) => <section key={key} aria-label={group.label}>
            <h3 className="sticky top-0 bg-paper-raised px-3 pb-1 pt-3 text-[11px] font-medium text-ink-muted">{group.label}</h3>
            <div className="flex flex-col gap-1">{group.jobs.map((job) => <JobRow key={job.id} job={job} sessionId={sessionId} busy={busy} confirming={confirm === job.id} onConfirm={() => setConfirm(job.id)} onDismiss={() => setConfirm('')} onAction={(retry) => void act(job, retry)} />)}</div>
          </section>) : !error ? <Empty className="py-8"><EmptyHeader><EmptyMedia variant="icon"><Clock /></EmptyMedia><EmptyTitle>{search || status !== 'all' ? '暂无匹配任务' : '每次生成都有记录'}</EmptyTitle><EmptyDescription>{search || status !== 'all' ? '试试其它关键词，或查看全部任务。' : '提交生成后，可在这里查看排队进度、结果和失败原因。'}</EmptyDescription></EmptyHeader>{search || status !== 'all' ? <EmptyContent><Button type="button" variant="outline" size="sm" onClick={() => { setSearch(''); setStatus('all'); requestAnimationFrame(() => searchRef.current?.focus()); }}>查看全部任务</Button></EmptyContent> : null}</Empty> : null}
      </div>
      <Separator />
      <footer className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <span className="text-[11px] text-ink-muted">第 {cursors.length + 1} 页{page.jobs.length ? `，${page.jobs.length} 条记录` : ''}</span>
        <div className="flex gap-1"><Tooltip content="上一页"><Button type="button" variant="ghost" size="icon-xs" aria-label="上一页任务" disabled={!cursors.length || loading || Boolean(busy)} onClick={() => { setConfirm(''); setPage({ jobs: [] }); setLoading(true); setCursors((value) => value.slice(0, -1)); }}><ChevronLeft /></Button></Tooltip>
          <Tooltip content="下一页"><Button type="button" variant="ghost" size="icon-xs" aria-label="下一页任务" disabled={!page.nextCursor || loading || Boolean(busy)} onClick={() => { const nextCursor = page.nextCursor; setConfirm(''); setPage({ jobs: [] }); setLoading(true); setCursors((value) => [...value, nextCursor]); }}><ChevronRight /></Button></Tooltip></div>
      </footer>
    </CanvasUtilityPanel>
  </Panel>;
}

import { useEffect, useRef, useState } from 'react';
import { Download, FileSliders, LoaderCircle, LocateFixed, RotateCcw, Square, Clock } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { NodeProps } from '@xyflow/react';
import type { PresentationSource } from '../../../shared/canvasPresentation';
import type { CanvasJobSummary } from '../../../shared/canvasJobs';
import { artifactRawUrl, cancelCanvasJob, listCanvasJobs, retryCanvasJob } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import type { CanvasNodeData } from './ImageNode';
import FloatingNodeHeader from './FloatingNodeHeader';
import NodeCornerResizer from './NodeCornerResizer';
import AgentMark from './AgentMark';
import { useHoverIntent } from './NodeActionBar';

const pendingRetries = new Map<string, { jobId: string; operationId: string }>();

export default function PresentationExportNote({ data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark } = data as CanvasNodeData;
  const canvasId = useCanvasStore((state) => state.canvasIdBySession[sessionId]);
  const allNodes = useCanvasStore((state) => state.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const storedSources = (node.params as { localExport?: { sources?: PresentationSource[] } }).localExport?.sources;
  const sources = Array.isArray(storedSources) ? storedSources.filter((source) => source && typeof source.path === 'string' && typeof source.title === 'string') : [];
  const { hovered, hoverProps } = useHoverIntent();
  const [download, setDownload] = useState<{ key: string; url: string }>();
  const [urlError, setUrlError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [currentJob, setCurrentJob] = useState<CanvasJobSummary>();
  const [jobRevision, setJobRevision] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const scope = useRef(canvasId); scope.current = canvasId;
  const attemptKey = `${canvasId}:${node.id}`;
  const knownJob = jobRevision === node.updatedAt ? currentJob : undefined;
  const running = node.runState === 'running' || knownJob?.status === 'queued' || knownJob?.status === 'running';
  const version = node.output?.artifactVersion;
  const artifactId = node.output?.artifactId;
  const downloadKey = `${artifactId}:${version}`;
  const url = download?.key === downloadKey ? download.url : '';
  const retryable = knownJob?.isCurrent && ['failed', 'interrupted', 'cancelled'].includes(knownJob.status);
  const unknownRetry = pendingRetries.has(attemptKey);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true; setDownload(undefined); setUrlError('');
    if (artifactId && typeof version === 'number' && Number.isInteger(version) && version > 0) void artifactRawUrl(artifactId, version)
      .then((value) => { if (live) setDownload({ key: `${artifactId}:${version}`, url: value }); }).catch((reason) => { if (live) setUrlError(reason instanceof Error ? reason.message : '下载地址读取失败'); });
    return () => { live = false; };
  }, [artifactId, version, refresh]);
  useEffect(() => {
    if (!selected || !canvasId) return;
    let live = true; setChecking(true);
    // Only selected export notes read their job. Canvas-wide history owns continuous polling.
    void listCanvasJobs(canvasId, { search: node.id }).then((page) => {
      if (live) { setCurrentJob(page.jobs.find((job) => job.nodeId === node.id && job.isCurrent)); setJobRevision(node.updatedAt); setCheckError(''); }
    }).catch((reason) => { if (live) setCheckError(reason instanceof Error ? reason.message : '导出任务状态读取失败'); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [canvasId, node.id, node.runState, node.updatedAt, selected, refresh]);

  const act = async (retry: boolean) => {
    if (!canvasId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (retry) {
        let attempt = pendingRetries.get(attemptKey);
        if (!attempt) {
          const page = await listCanvasJobs(canvasId, { search: node.id });
          const job = page.jobs.find((item) => item.nodeId === node.id && item.isCurrent);
          if (!job || !['failed', 'interrupted', 'cancelled'].includes(job.status)) throw new Error('只有最新的失败、中断或取消任务可重试。请刷新任务状态。');
          attempt = { jobId: job.id, operationId: `pptx-retry:${nanoid()}` }; pendingRetries.set(attemptKey, attempt);
        }
        await retryCanvasJob(canvasId, attempt.jobId, attempt.operationId);
        pendingRetries.delete(attemptKey);
      } else {
        const page = await listCanvasJobs(canvasId, { search: node.id });
        const job = page.jobs.find((item) => item.nodeId === node.id && item.isCurrent);
        if (!job || !['queued', 'running'].includes(job.status)) throw new Error('任务已结束，请刷新状态后查看结果。');
        await cancelCanvasJob(canvasId, job.id);
      }
      if (mounted.current && scope.current === canvasId) setRefresh((value) => value + 1);
    } catch (reason) { if (mounted.current && scope.current === canvasId) setError(reason instanceof Error ? reason.message : '本地导出操作未完成'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const jobStatus = knownJob?.status;
  const status = running ? '本地导出中' : jobStatus === 'interrupted' ? '导出已中断' : jobStatus === 'cancelled' ? '导出已取消'
    : node.runState === 'error' ? '导出失败' : artifactId && version ? '已有导出文件' : '等待任务状态';

  return <div {...hoverProps} className={cn('relative flex h-full w-full flex-col rounded-2xl border bg-paper-raised p-0 text-ink shadow-sm', selected ? 'border-accent ring-1 ring-accent/20' : 'border-line', highlighted && 'canvas-node-highlight')}>
    <AgentMark show={agentMark} /><NodeCornerResizer nodeId={node.id} sessionId={sessionId} hovered={hovered} minWidth={300} minHeight={220} />
    <FloatingNodeHeader sessionId={sessionId} nodeId={node.id} title={node.title} fallback="演示稿导出" icon={<FileSliders size={13} className="text-accent" />} selected={selected} hovered={hovered} />
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-medium" role="status">{running ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <FileSliders size={14} />}{status}</span><span className="text-[11px] text-ink-muted">PPTX · {node.output?.pageCount ?? sources.length} 页</span></div>
      <p className="text-[11px] leading-relaxed text-ink-muted">本地排版现有图片，每图一页。</p>
      <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {node.output?.error ? <p className="select-text whitespace-pre-wrap text-xs leading-relaxed text-danger [overflow-wrap:anywhere]">{node.output.error}</p> : null}
        {error || checkError || urlError ? <Alert variant="destructive" className="p-2"><AlertDescription className="min-w-0 text-[11px] [overflow-wrap:anywhere]">{error || checkError || urlError}<Button type="button" variant="ghost" size="xs" disabled={busy || checking} onClick={() => setRefresh((value) => value + 1)}>刷新状态</Button></AlertDescription></Alert> : null}
        {selected ? <details className="text-[11px]"><summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">查看 {sources.length} 页来源</summary><ol className="mt-2 flex flex-col gap-1">{sources.map((source, index) => <li key={`${index}:${source.path}`}><Button type="button" variant="ghost" size="xs" className="w-full justify-start" disabled={!source.nodeId || !allNodes.some((item) => item.id === source.nodeId)} onClick={() => { if (source.nodeId) canvasStore.focusNode(sessionId, source.nodeId); }}><LocateFixed data-icon="inline-start" /><span className="truncate" title={source.title}>{index + 1}. {source.title}</span></Button></li>)}</ol></details> : null}
      </div>
      <div className="nodrag flex flex-wrap gap-1.5" onKeyDown={(event) => event.stopPropagation()}>
        {url ? <Button asChild size="xs"><a href={url} download><Download data-icon="inline-start" />下载 v{version}{running || node.runState === 'error' ? ' · 上次结果' : ''}</a></Button> : null}
        {selected && (retryable || unknownRetry) ? <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => void act(true)}>{busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <RotateCcw data-icon="inline-start" />}{unknownRetry ? '确认重试状态' : '本地重试'}</Button> : null}
        {selected && running ? <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => void act(false)}><Square data-icon="inline-start" />取消</Button> : null}
        {selected ? <Button type="button" variant="ghost" size="xs" onClick={() => window.dispatchEvent(new CustomEvent('canvas-open-jobs', { detail: { sessionId, nodeId: node.id } }))}><Clock data-icon="inline-start" />任务历史</Button> : null}
      </div>
    </div>
  </div>;
}

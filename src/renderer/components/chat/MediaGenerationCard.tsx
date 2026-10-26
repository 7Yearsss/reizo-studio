import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Expand, LayoutDashboard, LoaderCircle } from 'lucide-react';
import type { ToolCallPart } from '../../../shared/chat';
import type { CanvasNodeOutput } from '../../../shared/canvas';
import { isCanvasJobTerminal, type CanvasJob } from '../../../shared/canvasJobs';
import { apiOrigin, getCanvasJob, queryCanvasVideoJob } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import * as uiStore from '../../state/uiStore';
import * as tabStore from '../../state/tabStore';
import { toast } from '../../lib/toast';
import { ImageGeneration } from '../agents/image-generation';
import Lightbox from '../canvas/Lightbox';

export function isChatMediaTool(name: string): boolean {
  return name === 'generate_image' || name === 'create_image' || name === 'generate_video';
}

function readResult(part: ToolCallPart): Record<string, unknown> {
  if (!part.result) return {};
  try {
    const parsed = JSON.parse(part.result);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return /^(https?:|data:image\/|\/api\/)/.test(part.result) ? { url: part.result } : {};
  }
}
const stringOf = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** A saved job, rather than the mutable canvas node, owns this message's result. */
export default function MediaGenerationCard({ part, sessionId, interrupted = false }: {
  part: ToolCallPart; sessionId?: string; interrupted?: boolean;
}) {
  const result = readResult(part);
  const video = part.name === 'generate_video';
  const kind = video ? '视频' : '图片';
  const jobId = stringOf(result.jobId);
  const canvasId = stringOf(result.canvasId);
  const jobKey = `${canvasId}:${jobId}`;
  const foreground = useSyncExternalStore(tabStore.subscribe, () => {
    const { tabs, activeTabId } = tabStore.getSnapshot();
    return !sessionId || !tabs.some(tab => tab.sessionId === sessionId) ||
      tabs.some(tab => tab.id === activeTabId && tab.sessionId === sessionId);
  }, () => true);
  const [saved, setSaved] = useState<{ key: string; job: CanvasJob }>();
  const job = saved?.key === jobKey ? saved.job : undefined;
  const [connectionError, setConnectionError] = useState('');
  const [retryRead, setRetryRead] = useState(0);
  const [resolved, setResolved] = useState<{ source: string; url: string }>();
  const [previewing, setPreviewing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [failedUrl, setFailedUrl] = useState('');
  const [querying, setQuerying] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const output = (job?.result ?? result.output) as CanvasNodeOutput | undefined;
  const version = output?.resultSet?.[0];
  const asset = version?.asset ?? output?.assets?.[0];
  const rawUrl = asset ? `/api/canvas/assets/${asset}` :
    stringOf(result.imageUrl) ?? stringOf(result.videoUrl) ?? stringOf(result.url) ?? stringOf(result.dataUrl) ?? stringOf(result.src) ?? '';
  const nodeId = job?.nodeId ?? stringOf(result.nodeId) ?? stringOf(result.id);
  const prompt = stringOf(result.prompt) ?? stringOf(part.args.prompt);
  const modelLabel = job?.model ?? stringOf(result.modelName) ?? stringOf(result.model) ?? stringOf(part.args.model);
  const error = job?.error ?? (!job || job.status === 'failed' || job.status === 'interrupted' ? part.error ?? stringOf(result.error) : undefined) ??
    (job && ['cancelled', 'interrupted'].includes(job.status) ? `${kind}生成已停止` : undefined) ??
    (job?.status === 'failed' || !job && result.ok === false ? `${kind}生成失败，请重试` : undefined) ??
    (job?.status === 'succeeded' && !rawUrl ? `任务未返回有效${kind}，请重试` : undefined) ??
    (!jobId && !rawUrl && interrupted ? `${kind}生成已中断` : undefined);
  const receiptPending = !!jobId && !!canvasId && !rawUrl && !error;
  const readReceipt = !!jobId && !!canvasId && !rawUrl && (!job || !isCanvasJobTerminal(job.status));
  const status = error ? 'error' : rawUrl ? 'complete' : 'generating';
  const url = resolved?.source === rawUrl ? resolved.url : /^(https?:|data:|blob:)/.test(rawUrl) ? rawUrl : '';
  const size = stringOf(result.size) ?? stringOf(part.args.size) ?? stringOf(part.args.resolution) ?? '1024x1024';
  const dimensions = /(\d+)\s*[x×]\s*(\d+)/i.exec(size);
  const ratio = video ? (stringOf(result.ratio) ?? stringOf(part.args.ratio) ?? '16:9').replace(':', ' / ') :
    dimensions && Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0 ? `${dimensions[1]} / ${dimensions[2]}` : '1 / 1';
  const startedAt = stringOf(job?.input?.queryRecoverySubmittedAt) ?? job?.submittedAt ?? job?.createdAt;
  const elapsed = startedAt ? Math.max(0, Math.floor((clock - Date.parse(startedAt)) / 1000)) : 0;
  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒` : `${elapsed} 秒`;
  const observation = job?.observation;
  const progress = observation?.status !== 'reconnecting' && typeof observation?.progress === 'number' ? observation.progress : undefined;
  const videoStatus = observation?.status === 'reconnecting' ? '查询暂时中断，正在自动重连…' :
    observation?.status === 'downloading' ? '生成已完成，正在取回视频…' :
    observation?.status === 'queued' || job?.status === 'queued' ? '正在排队生成视频…' : '正在生成视频…';
  const canQuery = video && job?.status === 'interrupted' && !!job.remoteTask?.taskId;

  useEffect(() => {
    if (!rawUrl || /^(https?:|data:|blob:)/.test(rawUrl)) return;
    let disposed = false;
    void apiOrigin().then(origin => {
      if (!disposed) setResolved({ source: rawUrl, url: `${origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}` });
    }).catch(() => { if (!disposed) setFailedUrl(rawUrl); });
    return () => { disposed = true; };
  }, [rawUrl]);

  useEffect(() => {
    if (!foreground || !readReceipt || !canvasId || !jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await getCanvasJob(canvasId, jobId, controller.signal);
        if (controller.signal.aborted) return;
        setSaved({ key: jobKey, job: next });
        setClock(Date.now());
        setConnectionError('');
        if (isCanvasJobTerminal(next.status)) return;
      } catch {
        if (controller.signal.aborted) return;
        setConnectionError('暂时无法更新生成状态，正在重新连接…');
      }
      timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [foreground, readReceipt, canvasId, jobId, jobKey, retryRead]);

  useEffect(() => {
    if (!foreground || !video || !receiptPending || !startedAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [foreground, video, receiptPending, startedAt]);

  async function continueQuery() {
    if (!canvasId || !job || querying) return;
    setQuerying(true);
    try {
      const recovered = await queryCanvasVideoJob(canvasId, job.id);
      setSaved({ key: jobKey, job: recovered });
      setConnectionError('');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '继续查询失败，请稍后重试'); }
    finally { setQuerying(false); }
  }

  async function bringToCanvas() {
    if (!sessionId || !url || opening) return;
    setOpening(true);
    try {
      // A fresh snapshot is needed when generation finished with the panel closed.
      await canvasStore.openCanvas(sessionId);
      const nodes = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
      const path = asset ?? rawUrl.split('/api/canvas/assets/')[1];
      let node = nodes.find(n => n.id === nodeId && (!path || n.output?.assets?.[n.output.activeAssetIndex ?? 0] === path));
      node ??= nodes.find(n => path && n.output?.assets?.[n.output.activeAssetIndex ?? 0] === path);
      const assetId = version?.assetId ?? stringOf(result.assetId);
      if (!node && assetId) {
        const right = nodes.reduce((value, n) => Math.max(value, n.x + n.w), 0);
        node = await canvasStore.reuseAsset(sessionId, { assetId, x: right + 40, y: 60, title: prompt?.slice(0, 40) || `对话生成${kind}` }) ?? undefined;
      }
      if (!node) throw new Error('此素材暂时无法带到画布，请先下载保存');
      uiStore.setRightPanelTabForSession(sessionId, 'canvas');
      canvasStore.focusNode(sessionId, node.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '打开画布失败');
    } finally { setOpening(false); }
  }

  async function download() {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('下载失败，请重试');
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = asset?.split('/').pop() ?? `生成${kind}.${video ? 'mp4' : 'png'}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '下载失败'); }
    finally { setDownloading(false); }
  }

  const actionClass = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
  const previewFailed = !!rawUrl && (failedUrl === rawUrl || failedUrl === url);
  return (
    <div className="my-2 w-full max-w-sm" data-slot="chat-media" data-media-kind={video ? 'video' : 'image'}>
      <ImageGeneration status={previewFailed ? 'error' : status} prompt={prompt} aspectRatio={ratio} mediaRole="group"
        size="fluid" interactive={false} resolution={video ? '' : size.replace('x', ' × ')}
        statusText={previewFailed ? '预览加载失败，可下载素材后查看' : error ?? (status === 'complete' ? `${kind}已就绪` : video ? videoStatus : `正在生成${kind}…`)}
        mediaClassName="[&>*]:!object-contain [&_img]:!object-contain">
        {url && !previewFailed ? video ? (
          <video key={url} src={url} controls playsInline preload="metadata" aria-label={prompt || '生成视频'} onError={() => setFailedUrl(url)} />
        ) : (
          <button type="button" onClick={() => setPreviewing(true)} aria-label="放大图片" className="cursor-zoom-in">
            <img src={url} alt={prompt || '生成图片'} onError={() => setFailedUrl(url)} />
          </button>
        ) : null}
      </ImageGeneration>
      {video && receiptPending && job ? <div className="mt-2 space-y-1.5 text-xs text-ink-muted" role="status">
        <div className="flex items-center justify-between gap-3"><span>{startedAt ? `已等待 ${elapsedLabel}` : '准备提交'}</span>
          {progress !== undefined ? <span>供应商进度 {Math.round(progress)}%</span> : null}</div>
        {progress !== undefined ? <div role="progressbar" aria-label="供应商视频生成进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-paper-inset">
          <div className="h-full rounded-full bg-ink-muted transition-[width]" style={{ width: `${progress}%` }} />
        </div> : null}
        <p>{elapsed >= 10 * 60 ? '本次生成耗时较长，仍在跟踪原任务。可以继续聊天，完成后会自动显示，无需重新生成。' : '可以继续聊天或切换对话，工作台会在后台跟踪，完成后自动显示。'}</p>
        {job.remoteTask?.taskId ? <p className="truncate select-text" title={job.remoteTask.taskId}>任务编号：{job.remoteTask.taskId}</p> : null}
      </div> : null}
      {modelLabel ? <p className="mt-2 truncate text-xs text-ink-muted" title={`生成模型：${modelLabel}`}>模型：{modelLabel}</p> : null}
      {canQuery ? <div className="mt-2 text-xs text-ink-muted">
        <button type="button" className={actionClass} disabled={querying} onClick={() => void continueQuery()}><LoaderCircle size={13} className={querying ? 'animate-spin' : ''} />{querying ? '正在恢复查询…' : '继续查询'}</button>
        <p className="mt-1">取回原任务结果，不会重新提交生成。</p>
      </div> : null}
      {connectionError && !error && !rawUrl ? <p role="status" className="mt-2 text-xs text-ink-muted">{connectionError} <button type="button" onClick={() => setRetryRead(n => n + 1)} className="underline">刷新状态</button></p> : null}
      {error ? <p role="alert" className="sr-only">{error}</p> : null}
      {url ? <div className="mt-2 flex flex-wrap items-center gap-1">
        {!video && <button type="button" className={actionClass} onClick={() => setPreviewing(true)}><Expand size={13} />放大</button>}
        <button type="button" className={actionClass} onClick={() => void download()} disabled={downloading}><Download size={13} />{downloading ? '下载中…' : '下载'}</button>
        {sessionId && <button type="button" className={actionClass} onClick={() => void bringToCanvas()} disabled={opening}>
          {opening ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : <LayoutDashboard size={13} />}带到画布
        </button>}
      </div> : null}
      {previewing && url && !video ? <Lightbox src={url} onClose={() => setPreviewing(false)} /> : null}
    </div>
  );
}

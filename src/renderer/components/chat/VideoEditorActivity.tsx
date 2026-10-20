import { useEffect, useState } from 'react';
import { readEditorContext, readCompositionImage, editorRenderRequest, retryEditorExport } from '../../api';
import type { EditorObservation } from '../../../shared/videoEditorContext';
import { setRightPanelTab } from '../../state/uiStore';
import { activeSessionId } from '../../state/tabStore';
import type { CompositionPreview } from '../../../shared/videoComposition';

function CompositionImages({ sessionId, preview }: { sessionId: string; preview: CompositionPreview }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const allocated: string[] = [];
    setUrls([]);
    void Promise.all(Array.from({ length: preview.imageCount }, async (_, index) => {
      const blob = await readCompositionImage(sessionId, preview.id, index);
      if (!alive) return '';
      const url = URL.createObjectURL(blob); allocated.push(url); return url;
    })).then((images) => { if (alive) setUrls(images.filter(Boolean)); }).catch((): void => undefined);
    return () => { alive = false; allocated.forEach((url) => URL.revokeObjectURL(url)); };
  }, [sessionId, preview.id, preview.imageCount]);
  return <details className="mt-2 border-t border-line pt-2" open>
    <summary className="cursor-pointer">草稿关键帧 · {preview.name ?? preview.plan?.name ?? '局部修改'} · {new Date(preview.createdAt).toLocaleTimeString('zh-CN')}</summary>
    <p className="my-2 whitespace-pre-line">{preview.summary}</p>
    {urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`剪辑草稿关键帧 ${index + 1}`} className="my-2 w-full rounded-md" /></a>)}
    <p>这是生成时的草稿快照。可在对话中继续提出修改；当前应用状态以编辑器为准。</p>
  </details>;
}

/** Actual editor feedback remains visible after the assistant's turn has ended. */
export default function VideoEditorActivity({ sessionId }: { sessionId: string }) {
  const [observation, setObservation] = useState<EditorObservation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const act = async (id: string, retry: boolean) => {
    setBusyId(id); setActionError(null);
    try {
      if (retry) await retryEditorExport(sessionId, id); else await editorRenderRequest(sessionId, 'DELETE', id);
      setObservation(await readEditorContext(sessionId));
    } catch (error) { setActionError(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusyId(null); }
  };
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    setObservation(null);
    const poll = async () => {
      try { if (activeSessionId() !== sessionId || document.hidden) return; const next = await readEditorContext(sessionId); if (alive) setObservation(next); }
      catch { if (alive) setObservation((value) => value ? { ...value, connected: false, context: null } : null); }
      finally { if (alive) timer = setTimeout(() => void poll(), 2000); }
    };
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [sessionId]);
  if (!observation || !observation.context && !observation.activities.length && !observation.composition && !observation.exports?.length) return null;
  const { context, connected, activities } = observation;
  return <section aria-label="剪辑操作反馈" className="rounded-xl border border-line bg-paper-raised px-3 py-2 text-xs text-ink-muted [overflow-wrap:anywhere]">
    <div className="flex items-center justify-between gap-2"><span>视频剪辑 · {connected ? '已连接' : '面板未连接，选择信息已过期'}</span><button type="button" onClick={() => setRightPanelTab('video')} className="shrink-0 text-ink">打开剪辑</button></div>
    {context && <p className="mt-2">{context.timeline.name} · {context.timeline.itemCount} 个片段 · 播放头 {context.playheadFrame ?? '未知'} 帧<br />选中素材 {context.selectedMedia.length} 项，片段 {context.selectedClips.length} 项{context.awaiting ? ` · ${context.awaiting === 'review' ? '等待应用修改' : '等待操作确认'}` : ''}{context.exporting ? ' · 正在导出' : ''}</p>}
    <ol className="mt-2 space-y-1" aria-live="polite">{activities.slice(-5).map((event) => <li key={event.id} className={event.state === 'failed' ? 'text-danger' : undefined}><span className="mr-2 opacity-60">{new Date(event.at).toLocaleTimeString('zh-CN')}</span>{event.message}</li>)}</ol>
    {!!observation.exports?.length && <div className="mt-2 space-y-2 border-t border-line pt-2" aria-label="后台导出任务">
      <p>后台导出 · 关闭剪辑面板后继续</p>
      {observation.exports.map((job) => <div key={job.id}>
        <div className="flex items-center justify-between gap-2"><span>{job.name} · {({ queued: '排队中', submitting: '正在提交', rendering: '渲染中', saving: '正在保存', saved: '已保存到剪辑成片', cancelling: '正在取消', cancelled: '已取消', failed: '失败', interrupted: '已中断' })[job.phase]}{['rendering', 'saving'].includes(job.phase) ? ` ${Math.round(job.progress)}%` : ''}</span>
          {['queued', 'submitting', 'rendering'].includes(job.phase) && <button disabled={busyId === job.id} onClick={() => void act(job.id, false)}>取消</button>}
          {['failed', 'interrupted', 'cancelled'].includes(job.phase) && !observation.exports?.some((other) => other.id === job.retryId) && <button disabled={busyId === job.id} onClick={() => void act(job.id, true)}>重试</button>}
        </div>
        {job.error && <p className="text-danger">{job.error}</p>}
      </div>)}
      {actionError && <p role="alert" className="text-danger">{actionError}</p>}
    </div>}
    {observation.composition && <CompositionImages sessionId={sessionId} preview={observation.composition} />}
  </section>;
}

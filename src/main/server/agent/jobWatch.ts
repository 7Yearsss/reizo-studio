import { nanoid } from 'nanoid';
import { getCanvasChannel } from '../canvas/channel';
import type { CanvasStore } from '../storage/canvasStore';
import { canvasWorkSignal, canvasWorkStopped } from '../canvas/workLifecycle';
import { isCanvasJobTerminal } from '../../../shared/canvasJobs';
import { isSessionTurnLive } from './session';
import { pushSteer } from './steerInbox';

/**
 * Background-job watch (DSH `jobs` lane): `run_node`/`run_graph` with
 * `wait:false` return the job to the caller instantly; the watching agent's
 * turn keeps going. When each watched node settles, a system steer note is
 * injected into the turn at the next step boundary so the model can relay or
 * react — instead of the agent polling read_canvas.
 *
 * If the turn is no longer live when a job settles, the note is dropped: the
 * canvas toast + OS notification already tell the user, and a stale system
 * note landing in the next turn would read as a phantom user message.
 */

interface WatchedJob {
  sessionId: string;
  canvasId: string;
  canvasStore: CanvasStore;
  jobId?: string;
  cleanup: () => void;
}

const watches = new Map<string, WatchedJob>(); // `${canvasId}:${nodeId}`
const subscribedCanvases = new Set<string>();

function onNodeSettled(job: WatchedJob, nodeId: string): void {
  if (!isSessionTurnLive(job.sessionId) || canvasWorkStopped(job.canvasStore)) return;
  if (job.jobId) {
    const saved = job.canvasStore.jobs.get(job.jobId);
    if (!saved || !isCanvasJobTerminal(saved.status)) return;
    const source = saved.input.node as { title?: string } | undefined;
    const title = source?.title || nodeId;
    const content = saved.status === 'succeeded'
      ? `[系统通知] 后台任务完成：节点「${title}」的结果已落在画布上`
      : saved.status === 'cancelled'
        ? `[系统通知] 后台任务已停止：节点「${title}」${saved.cancelReason === 'superseded' ? '已被后续生成替换' : '已取消'}`
        : `[系统通知] 后台任务失败：节点「${title}」报错：${saved.error || '生成已中断'}`;
    pushSteer(job.sessionId, { id: `job-${nanoid(8)}`, system: true, content });
    return;
  }
  const node = job.canvasStore.getNode(job.canvasId, nodeId);
  const title = node?.title || nodeId;
  const error = node?.output?.error;
  pushSteer(job.sessionId, {
    id: `job-${nanoid(8)}`,
    system: true,
    content: error
      ? `[系统通知] 后台任务失败：节点「${title}」报错：${error}`
      : `[系统通知] 后台任务完成：节点「${title}」的结果已落在画布上`,
  });
}

function dropWatch(key: string): void {
  const job = watches.get(key);
  if (!job) return;
  watches.delete(key);
  job.cleanup();
}

function ensureSubscribed(canvasId: string): void {
  if (subscribedCanvases.has(canvasId)) return;
  subscribedCanvases.add(canvasId);
  getCanvasChannel(canvasId).subscribe((envelope) => {
    const event = envelope.event;
    if (event.type === 'node_deleted') {
      dropWatch(`${envelope.canvasId}:${event.id}`);
      return;
    }
    const node = event.type === 'node_updated' ? event.node : null;
    if (event.type !== 'run_state' && event.type !== 'node_output' && !node) return;
    const state = node?.runState ?? ('runState' in event ? event.runState : undefined);
    const nodeId = node?.id ?? ('id' in event ? event.id : '');
    const key = `${envelope.canvasId}:${nodeId}`;
    const job = watches.get(key);
    if (!job) return;
    if (canvasWorkStopped(job.canvasStore)) { dropWatch(key); return; }
    if (job.jobId) {
      const saved = job.canvasStore.jobs.get(job.jobId);
      if (!saved || !isCanvasJobTerminal(saved.status)) return;
    } else if (state !== 'done' && state !== 'error') return;
    dropWatch(key);
    onNodeSettled(job, nodeId);
  });
}

export function watchCanvasNodeJob(
  sessionId: string,
  canvasId: string,
  canvasStore: CanvasStore,
  nodeIds: string[],
  jobId?: string,
): void {
  if (nodeIds.length === 0 || canvasWorkStopped(canvasStore)) return;
  ensureSubscribed(canvasId);
  for (const nodeId of nodeIds) {
    if (jobId) {
      const job = canvasStore.jobs.get(jobId);
      if (!job || job.canvasId !== canvasId || job.nodeId !== nodeId || !canvasStore.jobs.isCurrent(jobId)) continue;
    }
    const key = `${canvasId}:${nodeId}`;
    dropWatch(key);
    const signal = canvasWorkSignal(canvasStore);
    const watched: WatchedJob = { sessionId, canvasId, canvasStore, jobId, cleanup: () => signal.removeEventListener('abort', stop) };
    const stop = () => { if (watches.get(key) === watched) dropWatch(key); };
    signal.addEventListener('abort', stop, { once: true });
    watches.set(key, watched);
  }
}

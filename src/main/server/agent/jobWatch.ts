import { nanoid } from 'nanoid';
import { getCanvasChannel } from '../canvas/channel';
import type { CanvasStore } from '../storage/canvasStore';
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
}

const watches = new Map<string, WatchedJob>(); // `${canvasId}:${nodeId}`
const subscribedCanvases = new Set<string>();

function onNodeSettled(job: WatchedJob, nodeId: string): void {
  if (!isSessionTurnLive(job.sessionId)) return;
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

function ensureSubscribed(canvasId: string): void {
  if (subscribedCanvases.has(canvasId)) return;
  subscribedCanvases.add(canvasId);
  getCanvasChannel(canvasId).subscribe((envelope) => {
    if (envelope.event.type !== 'run_state') return;
    if (envelope.event.runState !== 'done' && envelope.event.runState !== 'error') return;
    const key = `${envelope.canvasId}:${envelope.event.id}`;
    const job = watches.get(key);
    if (!job) return;
    watches.delete(key);
    onNodeSettled(job, envelope.event.id);
  });
}

export function watchCanvasNodeJob(
  sessionId: string,
  canvasId: string,
  canvasStore: CanvasStore,
  nodeIds: string[],
): void {
  if (nodeIds.length === 0) return;
  ensureSubscribed(canvasId);
  for (const nodeId of nodeIds) {
    watches.set(`${canvasId}:${nodeId}`, { sessionId, canvasId, canvasStore });
  }
}

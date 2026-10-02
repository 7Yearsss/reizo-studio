import type { CanvasNode, CanvasNodeOutput } from '../../../shared/canvas';
import type { CanvasJob } from '../../../shared/canvasJobs';
import type { CanvasStore } from '../storage/canvasStore';
import { isRecoverableVideoJob } from './asyncJobManager';

export const INTERRUPTED_JOB_MESSAGE = '生成因应用退出或重启而中断，未自动重新提交。已有结果已保留，可检查后手动重试。';

function projectTerminal(store: CanvasStore, node: CanvasNode, job: CanvasJob): void {
  const output = { ...(node.output ?? {}) };
  delete output.progress;
  if (job.status === 'cancelled') {
    delete output.error;
    store.updateNode(node.canvasId, node.id, { runState: 'idle', output });
  } else if (job.status === 'succeeded') {
    const result = job.result as CanvasNodeOutput | undefined;
    const usable = Array.isArray(result?.assets) && result.assets.some((asset) => typeof asset === 'string' && Boolean(asset.trim())) ||
      typeof result?.text === 'string' && Boolean(result.text.trim());
    if (usable) {
      store.updateNode(node.canvasId, node.id, {
        runState: 'done', output: { ...output, ...result, error: undefined, progress: undefined },
        ...(job.inputHash ? { paramsHash: job.inputHash } : {}),
      });
    } else {
      store.updateNode(node.canvasId, node.id, {
        runState: 'error', output: { ...output, error: '任务已结束，但保存的结果不可用，请检查后手动重试。' },
      });
    }
  } else {
    store.updateNode(node.canvasId, node.id, {
      runState: 'error', output: { ...output, error: job.error || INTERRUPTED_JOB_MESSAGE },
    });
  }
}

/** Resume eligible videos by query only; all other unfinished attempts require an explicit retry. */
export function recoverCanvasJobs(store: CanvasStore, reason: 'restart' | 'shutdown' = 'restart') {
  return store.transaction(() => {
    let interrupted = 0;
    let legacy = 0;
    let repaired = 0;
    for (const job of store.jobs.unfinished()) {
      if (store.jobs.isCurrent(job.id) && isRecoverableVideoJob(job)) {
        const node = store.getNode(job.canvasId, job.nodeId);
        if (node.runState !== 'running') {
          store.updateNode(job.canvasId, job.nodeId, { runState: 'running', output: { ...node.output, error: undefined } });
          repaired += 1;
        }
        continue;
      }
      if (!store.jobs.finish(job.id, 'interrupted', { error: INTERRUPTED_JOB_MESSAGE, cancelReason: reason })) continue;
      interrupted += 1;
      const node = store.getNode(job.canvasId, job.nodeId);
      if (node && store.jobs.current(job.canvasId, job.nodeId)?.id === job.id) {
        projectTerminal(store, node, store.jobs.get(job.id));
        repaired += 1;
      }
    }
    for (const node of store.runningNodes()) {
      let job = store.jobs.current(node.canvasId, node.id);
      if (job && store.jobs.isCurrent(job.id) && isRecoverableVideoJob(job)) continue;
      // Old executors have no durable attempt identity. Record that uncertainty instead of inferring success.
      if (!job) {
        job = store.jobs.enqueue({
          canvasId: node.canvasId, nodeId: node.id, nodeType: node.type,
          input: { legacy: true, nodeId: node.id, nodeType: node.type, title: node.title },
        });
        store.jobs.finish(job.id, 'interrupted', { error: INTERRUPTED_JOB_MESSAGE, cancelReason: reason });
        job = store.jobs.get(job.id);
        legacy += 1;
      }
      projectTerminal(store, node, job);
      repaired += 1;
    }
    return { interrupted, legacy, repaired };
  });
}

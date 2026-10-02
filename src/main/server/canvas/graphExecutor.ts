import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { startImageNode } from './imageExecutor';
import { runAgentNode } from './agentExecutor';
import { startVideoNode } from './videoExecutor';
import { nanoid } from 'nanoid';
import { startAudioNode } from './audioExecutor';
import type { ProviderStore } from '../storage/providerStore';
import { descendants, directUpstream, topoOrder, buildPipelineWaves, inputHash, isImportedMedia } from './graph';
import { nodeJobsFor, type NodeJobSubmission } from './nodeJobs';
import { canvasWorkStopped } from './workLifecycle';
import { cancelVideoJobsForCanvas } from './asyncJobManager';

/** Node types the executor knows how to run. */
// `note` / `group` / `anchor` are inert: `anchor` is a reference pin consumed
// by imageExecutor, never executed, and `buildPipelineWaves` already walks
// dependencies through non-runnable nodes.
const RUNNABLE = new Set(['image', 'agent', 'video', 'audio']);

/**
 * Maximum concurrent node executions per wave.
 * Capped to bound provider rate-limiting (HTTP 429) while keeping multi-shot
 * listing/storyboard sets close to single-image wall time. 8 covers a full
 * e-commerce sheet (assets + 7 finishers) in roughly two provider windows.
 */
export const MAX_CONCURRENCY = 8;

/** In-flight `runGraph` per canvas, so a "stop" can abort between nodes. */
const activeRuns = new Map<string, { controller: AbortController; store: CanvasStore }>();

export function isCanvasRunning(canvasId: string): boolean {
  return activeRuns.has(canvasId);
}

export function stopCanvasRun(canvasId: string, store?: CanvasStore): boolean {
  const candidate = activeRuns.get(canvasId);
  const run = !store || candidate?.store === store ? candidate : undefined;
  run?.controller.abort();
  const repository = store ?? run?.store;
  const stoppedNodes = repository ? nodeJobsFor(repository).cancelCanvas(canvasId) : false;
  const stoppedVideos = repository ? cancelVideoJobsForCanvas(repository, canvasId) : false;
  return Boolean(run) || stoppedNodes || stoppedVideos;
}

export function stopCanvasRunsForStore(store: CanvasStore): void {
  for (const [canvasId, run] of activeRuns) {
    if (run.store !== store) continue;
    activeRuns.delete(canvasId);
    run.controller.abort('shutdown');
  }
}

/**
 * Run a canvas as a DAG: waves of independent nodes execute in parallel (up to MAX_CONCURRENCY).
 * A node runs only after every direct upstream is `done`.
 * An upstream error marks downstream nodes `error` and skips them.
 * `fromNodeId`: restricts the run to that node and its descendants.
 * `nodeIds`: restricts the run to an explicit whitelist of node IDs (e.g. running a group).
 */
export async function runGraph(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  fromNodeId?: string;
  nodeIds?: string[];
  providerId?: string;
  providerStore?: ProviderStore;
  onJob?: (submission: NodeJobSubmission) => void;
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, fromNodeId, nodeIds, providerId, providerStore } = options;
  if (canvasWorkStopped(canvasStore)) return;
  const snapshot = canvasStore.getSnapshot(canvasId);
  if (!snapshot) return;
  const { nodes, edges } = snapshot;

  const { cycle } = topoOrder(nodes, edges);
  if (cycle) return; // cycle guard

  const inScope = new Set<string>(nodes.map((n) => n.id));
  if (nodeIds && nodeIds.length > 0) {
    const whitelist = new Set(nodeIds);
    for (const id of [...inScope]) {
      if (!whitelist.has(id)) inScope.delete(id);
    }
  } else if (fromNodeId) {
    const keep = descendants(edges, fromNodeId);
    keep.add(fromNodeId);
    for (const id of [...inScope]) {
      if (!keep.has(id)) inScope.delete(id);
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const channel = getCanvasChannel(canvasId);
  const failed = new Set<string>();
  const runId = nanoid();

  const waves = buildPipelineWaves(
    nodes,
    edges,
    (type) => RUNNABLE.has(type),
    inScope,
  );

  const total = waves.reduce((acc, wave) => acc + wave.length, 0);
  if (total === 0) return;

  const abort = new AbortController();
  activeRuns.get(canvasId)?.controller.abort();
  const run = { controller: abort, store: canvasStore };
  activeRuns.set(canvasId, run);
  const canRun = () => !canvasWorkStopped(canvasStore) && !abort.signal.aborted && activeRuns.get(canvasId) === run;
  const rev = () => canvasStore.getCanvas(canvasId)?.liveRevision ?? 0;
  channel.broadcast(rev(), { type: 'graph_run', running: true, done: 0, total });

  let done = 0;
  let succeeded = 0;
  let skipped = 0;
  let failedCount = 0;
  try {

    const runOne = async (id: string): Promise<void> => {
      if (!canRun()) return;
      const node = byId.get(id);
      if (!node || !RUNNABLE.has(node.type)) return;

      const brokenUpstream = directUpstream(edges, id).some((u) => failed.has(u));
      if (brokenUpstream) {
        failed.add(id);
        const res = canvasStore.updateNode(canvasId, id, {
          runState: 'error',
          output: { ...(canvasStore.getNode(canvasId, id)?.output ?? {}), error: 'Upstream node failed' },
        });
        if (res) {
          channel.broadcast(res.rev, {
            type: 'node_output',
            id,
            output: res.node.output ?? { error: 'Upstream node failed' },
            runState: 'error',
          });
        }
        done += 1;
        skipped += 1;
        channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
        return;
      }

      // `runImageNode` / `runVideoNode` re-reads the node so re-read fresh snapshot
      const fresh = canvasStore.getNode(canvasId, id);
      if (!fresh) {
        failed.add(id);
        done += 1;
        skipped += 1;
        return;
      }
      if (isImportedMedia(fresh)) {
        done += 1;
        skipped += 1;
        channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
        return;
      }

      // Cache-hit skip: if node is already completed and inputs haven't drifted, skip re-running!
      const upIds = directUpstream(edges, id);
      const upstreamNodes = upIds
        .map((uId) => canvasStore.getNode(canvasId, uId))
        .filter((u): u is NonNullable<typeof u> => !!u);
      const currentHash = inputHash(fresh, upstreamNodes);

      if (fresh.runState === 'done' && fresh.paramsHash && fresh.paramsHash === currentHash) {
        done += 1;
        skipped += 1;
        channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
        return;
      }

      let jobId: string | undefined;
      try {
        if (fresh.type === 'agent') {
          await runAgentNode({
            canvasStore,
            settingsStore,
            dataRoot,
            canvasId,
            node: fresh,
            providerId,
            signal: abort.signal,
          });
        } else if (fresh.type === 'video' || fresh.type === 'image' || fresh.type === 'audio') {
          if (fresh.type === 'audio' && !providerStore) throw new Error('Audio node needs a provider store');
          const start = fresh.type === 'video' ? startVideoNode : fresh.type === 'image' ? startImageNode : startAudioNode;
          const submission = start({
            canvasStore,
            settingsStore,
            dataRoot,
            canvasId,
            node: fresh,
            providerId,
            signal: abort.signal,
            operationId: `graph:${runId}:${id}`,
            providerStore,
          });
          jobId = submission.job.id;
          options.onJob?.(submission);
          await submission.completion;
        }
      } catch (err) {
        if (!canRun()) return;
        console.warn(`[canvas] node ${id} execution error:`, err);
        const previous = canvasStore.getNode(canvasId, id);
        if (!abort.signal.aborted && previous && (!jobId || canvasStore.jobs.isCurrent(jobId))) {
          const updated = canvasStore.updateNode(canvasId, id, {
            runState: 'error', output: { ...(previous.output ?? {}), error: err instanceof Error ? err.message : String(err) },
          });
          if (updated) channel.broadcast(updated.rev, { type: 'node_updated', node: updated.node });
        }
      }

      if (!canRun()) return;
      const outcome = jobId ? canvasStore.jobs.get(jobId)?.status : canvasStore.getNode(canvasId, id)?.runState;
      if (outcome === 'failed' || outcome === 'interrupted' || outcome === 'error') {
        failed.add(id);
        failedCount += 1;
      } else if (outcome === 'succeeded' || outcome === 'done') {
        succeeded += 1;
      } else {
        // A replaced/deleted execution is not a successful upstream dependency.
        failed.add(id);
        skipped += 1;
      }
      done += 1;
      channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
    };

    for (const wave of waves) {
      if (!canRun()) break;

      // Execute wave in batches up to MAX_CONCURRENCY
      for (let i = 0; i < wave.length; i += MAX_CONCURRENCY) {
        if (!canRun()) break;
        const batch = wave.slice(i, i + MAX_CONCURRENCY);
        const outcomes = await Promise.allSettled(batch.map((id) => runOne(id)));
        if (canRun()) {
          outcomes.forEach((outcome, index) => {
            if (outcome.status === 'rejected') {
              failed.add(batch[index]);
              failedCount += 1;
              done += 1;
              console.error(`[canvas] node ${batch[index]} did not settle`, outcome.reason);
            }
          });
        }
      }
    }
  } finally {
    // An older run's finally must not announce that its replacement has stopped.
    if (activeRuns.get(canvasId) === run) {
      activeRuns.delete(canvasId);
      if (!canvasWorkStopped(canvasStore)) channel.broadcast(rev(), {
        type: 'graph_run', running: false, done, total, succeeded, skipped,
        failed: failedCount,
        outcome: abort.signal.aborted ? 'cancelled' : failed.size > 0 ? 'error' : 'completed',
      });
    }
  }
}

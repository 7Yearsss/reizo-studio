import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { runImageNode } from './imageExecutor';
import { runAgentNode } from './agentExecutor';
import { runVideoNode } from './videoExecutor';
import { descendants, directUpstream, topoOrder, buildPipelineWaves } from './graph';

/** Node types the executor knows how to run. */
const RUNNABLE = new Set(['image', 'agent', 'video']);

/**
 * Maximum concurrent node executions per wave.
 * Capped at 3 to prevent provider rate-limiting (HTTP 429) while still
 * delivering 3x faster multi-shot parallel generations.
 */
export const MAX_CONCURRENCY = 3;

/** In-flight `runGraph` per canvas, so a "stop" can abort between nodes. */
const activeRuns = new Map<string, AbortController>();

export function isCanvasRunning(canvasId: string): boolean {
  return activeRuns.has(canvasId);
}

export function stopCanvasRun(canvasId: string): boolean {
  const controller = activeRuns.get(canvasId);
  if (!controller) return false;
  controller.abort();
  return true;
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
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, fromNodeId, nodeIds, providerId } = options;
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

  const waves = buildPipelineWaves(
    nodes,
    edges,
    (type) => RUNNABLE.has(type),
    inScope,
  );

  const total = waves.reduce((acc, wave) => acc + wave.length, 0);
  if (total === 0) return;

  const abort = new AbortController();
  activeRuns.get(canvasId)?.abort();
  activeRuns.set(canvasId, abort);
  const rev = () => canvasStore.getCanvas(canvasId)?.liveRevision ?? 0;
  channel.broadcast(rev(), { type: 'graph_run', running: true, done: 0, total });

  try {
    let done = 0;

    const runOne = async (id: string): Promise<void> => {
      if (abort.signal.aborted) return;
      const node = byId.get(id);
      if (!node || !RUNNABLE.has(node.type)) return;

      const brokenUpstream = directUpstream(edges, id).some((u) => failed.has(u));
      if (brokenUpstream) {
        failed.add(id);
        const res = canvasStore.updateNode(canvasId, id, {
          runState: 'error',
          output: { error: 'Upstream node failed' },
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
        channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
        return;
      }

      // `runImageNode` / `runVideoNode` re-reads the node so re-read fresh snapshot
      const fresh = canvasStore.getNode(canvasId, id);
      if (!fresh) return;

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
        } else if (fresh.type === 'video') {
          await runVideoNode({
            canvasStore,
            settingsStore,
            dataRoot,
            canvasId,
            node: fresh,
            providerId,
            waitForCompletion: true,
          });
        } else {
          await runImageNode({
            canvasStore,
            settingsStore,
            dataRoot,
            canvasId,
            node: fresh,
            providerId,
          });
        }
      } catch (err) {
        console.warn(`[canvas] node ${id} execution error:`, err);
      }

      if (canvasStore.getNode(canvasId, id)?.runState === 'error') {
        failed.add(id);
      }
      done += 1;
      channel.broadcast(rev(), { type: 'graph_run', running: true, done, total });
    };

    for (const wave of waves) {
      if (abort.signal.aborted) break;

      // Execute wave in batches up to MAX_CONCURRENCY
      for (let i = 0; i < wave.length; i += MAX_CONCURRENCY) {
        if (abort.signal.aborted) break;
        const batch = wave.slice(i, i + MAX_CONCURRENCY);
        await Promise.allSettled(batch.map((id) => runOne(id)));
      }
    }
  } finally {
    if (activeRuns.get(canvasId) === abort) activeRuns.delete(canvasId);
    channel.broadcast(rev(), { type: 'graph_run', running: false, done: total, total });
  }
}

import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { runImageNode } from './imageExecutor';
import { descendants, directUpstream, topoOrder } from './graph';

/**
 * Run a canvas as a DAG: topological order, a node runs only after every
 * direct upstream is `done`. An upstream error marks this node `error` and
 * skips it. `fromNodeId` restricts the run to that node and its descendants.
 *
 * Sequential (image generation is the paid, slow step and providers rate-limit
 * hard); parallel independent branches land later if it matters.
 */
export async function runGraph(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  fromNodeId?: string;
  providerId?: string;
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, fromNodeId, providerId } = options;
  const snapshot = canvasStore.getSnapshot(canvasId);
  if (!snapshot) return;
  const { nodes, edges } = snapshot;

  const { order, cycle } = topoOrder(nodes, edges);
  if (cycle) return; // edges are rejected at creation time; belt-and-braces.

  const inScope = new Set<string>(nodes.map((n) => n.id));
  if (fromNodeId) {
    const keep = descendants(edges, fromNodeId);
    keep.add(fromNodeId);
    for (const id of [...inScope]) if (!keep.has(id)) inScope.delete(id);
  }

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const channel = getCanvasChannel(canvasId);
  const failed = new Set<string>();

  for (const id of order) {
    if (!inScope.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;

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
      continue;
    }

    if (node.type === 'image') {
      // `runImageNode` reads the node fresh (upstream outputs may have changed
      // during this run), so re-read rather than passing the stale snapshot.
      const fresh = canvasStore.getNode(canvasId, id);
      if (!fresh) continue;
      await runImageNode({ canvasStore, settingsStore, dataRoot, canvasId, node: fresh, providerId });
      if (canvasStore.getNode(canvasId, id)?.runState === 'error') failed.add(id);
    }
    // 'agent' nodes are skipped until P2.
  }
}

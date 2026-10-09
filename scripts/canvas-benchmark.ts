import { performance } from 'node:perf_hooks';
import { openDb } from '../src/main/server/db/client';
import { createSqliteSessionStore } from '../src/main/server/storage/sqliteSessionStore';
import { createCanvasStore } from '../src/main/server/storage/canvasStore';
import { projectCanvasChanges } from '../src/renderer/state/canvasSync';
import type { CanvasDocumentChange } from '../src/shared/canvasSync';

function measure(run: () => unknown) {
  run();
  const samples = Array.from({ length: 5 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return Math.round(samples[2] * 100) / 100;
}
async function main() {
  const results: unknown[] = [];
  for (const count of [1000, 5000]) {
    const handle = openDb(':memory:');
    try {
      const session = await createSqliteSessionStore(handle).create('benchmark', null, null);
      const store = createCanvasStore(handle);
      const id = store.ensureCanvas(session.id).id;
      const node = handle.raw.prepare("INSERT INTO canvas_nodes (id, canvas_id, type, x, y, w, h, title, params_json, params_hash, run_state, updated_at) VALUES (?, ?, 'image', ?, ?, 320, 380, 'bench', '{\"prompt\":\"bench\"}', 'ran-before', 'done', 0)");
      const edge = handle.raw.prepare('INSERT INTO canvas_edges (id, canvas_id, source_id, target_id) VALUES (?, ?, ?, ?)');
      handle.raw.exec('BEGIN');
      for (let i = 0; i < count; i++) {
        node.run(`n-${i}`, id, (i % 50) * 400, Math.floor(i / 50) * 450);
        if (i) edge.run(`e-${i}`, id, `n-${i - 1}`, `n-${i}`);
      }
      handle.raw.exec('COMMIT');
      const snapshot = store.getSnapshot(id);
      const changes = snapshot.nodes.slice(0, 1000).map((node): CanvasDocumentChange => ({ type: 'node_updated', node: { ...node, x: node.x + 1 } }));
      results.push({ nodes: count, edges: count - 1, snapshotMs: measure(() => store.getSnapshot(id)),
        project1000ChangesMs: measure(() => projectCanvasChanges(snapshot, changes)) });
    } finally { handle.close(); }
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, samples: 5, statistic: 'median', results }, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

import { randomUUID } from 'node:crypto';

// Explicit preview nonce prevents this harness from seeding a normal app instance.
const [nonce, topology = 'none', countText = '1000'] = process.argv.slice(2);
const count = Number(countText);
if (!nonce || !['none', 'chain'].includes(topology) || !Number.isInteger(count) || count < 1 || count > 5000) {
  throw new Error('Usage: node scripts/canvas-perf-fixture.mjs <preview-nonce> [none|chain] [1..5000]');
}
const origin = 'http://127.0.0.1:47160';
const guard = await fetch(`${origin}/_preview/capture?token=${encodeURIComponent(nonce)}`);
if (!guard.ok || !(await guard.text()).includes('本地验收截图保存')) throw new Error('Isolated preview identity not verified');
const prefix = randomUUID().replaceAll('-', '');
async function request(path, body, operation) {
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(operation ? { 'Idempotency-Key': operation } : {}),
  }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return response.json();
}
const title = `Performance ${count} notes ${topology} ${prefix.slice(0, 8)}`;
const { session } = await request('/api/sessions', { title });
const initial = await (await fetch(`${origin}/api/canvas/${session.id}`)).json();
const canvasId = initial.canvas.id;
const edits = Array.from({ length: count }, (_, index) => ({ kind: 'add_node', id: `perf_${prefix}_${index}`, node: {
  type: 'note', title: `Note ${index + 1}`, x: index % 40 * 400, y: Math.floor(index / 40) * 300,
  w: 320, h: 220, params: { content: `Performance fixture note ${index + 1}.` },
} }));
if (topology === 'chain') for (let index = 1; index < count; index++) edits.push({ kind: 'add_edge', edge: {
  id: `edge_${prefix}_${index}`, sourceId: `perf_${prefix}_${index - 1}`, targetId: `perf_${prefix}_${index}`,
  sourceHandle: 'prompt_out', targetHandle: 'text_in',
} });
for (let start = 0; start < edits.length; start += 500) await request(`/api/canvas/${canvasId}/edits`, {
  edits: edits.slice(start, start + 500),
}, `performance:${prefix}:${start}`);
const snapshot = await (await fetch(`${origin}/api/canvas/${session.id}`)).json();
if (snapshot.nodes.length !== count || snapshot.edges.length !== (topology === 'chain' ? count - 1 : 0)) throw new Error('Fixture counts differ');
console.log(JSON.stringify({ title, sessionId: session.id, canvasId, nodes: snapshot.nodes.length, edges: snapshot.edges.length }));

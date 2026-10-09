import { performance } from 'node:perf_hooks';
import { updateConnectionLookup } from '@xyflow/system';
import type { Edge, ReactFlowState } from '@xyflow/react';
import { hasHandleConnection } from '../src/renderer/components/canvas/handleConnection';
import { canvasInputSources } from '../src/renderer/state/canvasInputSources';
import type { CanvasNode, CanvasEdge } from '../src/shared/canvas';

const edges: Edge[] = Array.from({ length: 999 }, (_, index) => ({ id: `e${index}`, source: `n${index}`, target: `n${index + 1}`,
  ...(index % 10 ? { sourceHandle: 'out', targetHandle: 'in' } : {}) }));
const lookup: ReactFlowState['connectionLookup'] = new Map();
updateConnectionLookup(lookup, new Map(), edges);
const queries = Array.from({ length: 1000 }, (_, index) => [
  { node: `n${index}`, side: 'source' as const, port: 'out' }, { node: `n${index}`, side: 'target' as const, port: 'in' },
]).flat();
const scan = (node: string, side: 'source' | 'target', port: string) => edges.some((edge) => side === 'source'
  ? edge.source === node && (!edge.sourceHandle || !port || edge.sourceHandle === port)
  : edge.target === node && (!edge.targetHandle || !port || edge.targetHandle === port));
for (const query of queries) if (scan(query.node, query.side, query.port) !== hasHandleConnection(lookup, query.node, query.side, query.port)) throw new Error('Connection semantics differ');
function measure(run: typeof scan) {
  const pass = () => { let connected = 0; for (const query of queries) if (run(query.node, query.side, query.port)) connected++; return connected; };
  pass();
  const samples = Array.from({ length: 5 }, () => { const start = performance.now(); for (let replay = 0; replay < 10; replay++) pass(); return (performance.now() - start) / 10; }).sort((a,b) => a-b);
  return Number(samples[2].toFixed(3));
}
console.log(JSON.stringify({ nodes: 1000, edges: edges.length, queriesPerPass: queries.length, statistic: 'median of 5 x 10 passes',
  linearScanMs: measure(scan), indexedMs: measure((node, side, port) => hasHandleConnection(lookup, node, side, port)) }, null, 2));

const nodes: CanvasNode[] = Array.from({ length: 1000 }, (_, index): CanvasNode => ({ id: `n${index}`, title: `Note ${index}`, type: 'note', canvasId: 'c',
  x: index * 400, y: 0, w: 320, h: 220, params: {}, paramsHash: null, runState: 'idle', output: null, updatedAt: '' }));
const canvasEdges: CanvasEdge[] = edges.map((edge) => ({ id: edge.id, canvasId: 'c', sourceId: edge.source, targetId: edge.target,
  sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle }));
const initial = nodes.map((node) => canvasInputSources(nodes, canvasEdges, node.id));
const frames = Array.from({ length: 10 }, (_, index) => nodes.map((node) => node.id === 'n0' ? { ...node, x: index + 1 } : node));
function inputMeasure(indexed: boolean) {
  const samples = Array.from({ length: 5 }, () => {
    const start = performance.now();
    for (const frame of frames) for (const target of frame) {
      if (indexed) canvasInputSources(frame, canvasEdges, target.id);
      else canvasEdges.filter((edge) => edge.targetId === target.id).map((edge) => {
        const source = frame.find((node) => node.id === edge.sourceId);
        return { edgeId: edge.id, sourceTitle: source?.title || '节点', sourceType: source?.type || 'node' };
      });
    }
    return (performance.now() - start) / frames.length;
  }).sort((a,b) => a-b);
  return Number(samples[2].toFixed(3));
}
const moved = frames[0];
const retained = nodes.filter((node, index) => canvasInputSources(moved, canvasEdges, node.id) === initial[index]).length;
if (retained !== nodes.length) throw new Error('Geometry-only edits invalidated input metadata');
console.log(JSON.stringify({ metadataTargets: nodes.length, edges: canvasEdges.length, geometryOnlyReferencesRetained: retained,
  previousProjectionMs: inputMeasure(false), sharedProjectionMs: inputMeasure(true) }, null, 2));

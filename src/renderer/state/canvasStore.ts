import * as api from '../api';
import type { CanvasNode, CanvasEdge, CanvasNodeParams, CanvasSnapshot } from '../../shared/canvas';
import type { CanvasEvent } from '../../shared/canvasStream';

export interface GraphRun {
  running: boolean;
  done: number;
  total: number;
}

export interface CanvasState {
  canvasIdBySession: Record<string, string | undefined>;
  nodesBySession: Record<string, CanvasNode[]>;
  edgesBySession: Record<string, CanvasEdge[]>;
  loadedBySession: Record<string, boolean>;
  graphRunBySession: Record<string, GraphRun | undefined>;
}

let state: CanvasState = {
  canvasIdBySession: {},
  nodesBySession: {},
  edgesBySession: {},
  loadedBySession: {},
  graphRunBySession: {},
};

const listeners = new Set<() => void>();
const streamAborts = new Map<string, AbortController>();
const lastRevBySession = new Map<string, number>();
const moveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const selectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setState(patch: Partial<CanvasState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): CanvasState {
  return state;
}

function setNodes(sessionId: string, nodes: CanvasNode[]): void {
  setState({ nodesBySession: { ...state.nodesBySession, [sessionId]: nodes } });
}

function setEdges(sessionId: string, edges: CanvasEdge[]): void {
  setState({ edgesBySession: { ...state.edgesBySession, [sessionId]: edges } });
}

function ingestSnapshot(sessionId: string, snap: CanvasSnapshot): void {
  lastRevBySession.set(sessionId, snap.canvas.liveRevision);
  setState({
    canvasIdBySession: { ...state.canvasIdBySession, [sessionId]: snap.canvas.id },
    nodesBySession: { ...state.nodesBySession, [sessionId]: snap.nodes },
    edgesBySession: { ...state.edgesBySession, [sessionId]: snap.edges },
    loadedBySession: { ...state.loadedBySession, [sessionId]: true },
  });
}

function applyEvent(sessionId: string, event: CanvasEvent): void {
  const nodes = state.nodesBySession[sessionId] ?? [];
  const edges = state.edgesBySession[sessionId] ?? [];
  switch (event.type) {
    case 'node_added':
      if (!nodes.some((n) => n.id === event.node.id)) setNodes(sessionId, [...nodes, event.node]);
      break;
    case 'node_updated':
    case 'node_output':
    case 'run_state': {
      const patched = nodes.map((n) => {
        if (event.type === 'node_updated') return n.id === event.node.id ? event.node : n;
        if (n.id !== event.id) return n;
        if (event.type === 'run_state') return { ...n, runState: event.runState };
        return { ...n, runState: event.runState, output: event.output };
      });
      setNodes(sessionId, patched);
      break;
    }
    case 'node_deleted':
      setNodes(sessionId, nodes.filter((n) => n.id !== event.id));
      break;
    case 'edge_added':
      if (!edges.some((e) => e.id === event.edge.id)) setEdges(sessionId, [...edges, event.edge]);
      break;
    case 'edge_deleted':
      setEdges(sessionId, edges.filter((e) => e.id !== event.id));
      break;
    case 'graph_run':
      setState({
        graphRunBySession: {
          ...state.graphRunBySession,
          [sessionId]: event.running ? { running: true, done: event.done, total: event.total } : undefined,
        },
      });
      break;
    case 'heartbeat':
      break;
  }
}

async function runStream(sessionId: string, canvasId: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await api.readCanvasStream(
        canvasId,
        lastRevBySession.get(sessionId) ?? -1,
        (event, rev) => {
          lastRevBySession.set(sessionId, Math.max(lastRevBySession.get(sessionId) ?? 0, rev));
          applyEvent(sessionId, event);
        },
        signal,
      );
    } catch {
      /* reconnect below */
    }
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 1000));
    if (signal.aborted) return;
    try {
      ingestSnapshot(sessionId, await api.getCanvas(sessionId));
    } catch {
      /* keep retrying */
    }
  }
}

export async function openCanvas(sessionId: string): Promise<void> {
  if (streamAborts.has(sessionId)) return;
  const abort = new AbortController();
  streamAborts.set(sessionId, abort);
  try {
    const snap = await api.getCanvas(sessionId);
    ingestSnapshot(sessionId, snap);
    void runStream(sessionId, snap.canvas.id, abort.signal);
  } catch (err) {
    streamAborts.delete(sessionId);
    throw err;
  }
}

export function closeCanvas(sessionId: string): void {
  streamAborts.get(sessionId)?.abort();
  streamAborts.delete(sessionId);
}

function canvasId(sessionId: string): string | undefined {
  return state.canvasIdBySession[sessionId];
}

export function nodeById(sessionId: string, nodeId: string): CanvasNode | undefined {
  return (state.nodesBySession[sessionId] ?? []).find((n) => n.id === nodeId);
}

export async function addNode(
  sessionId: string,
  type: 'image' | 'agent',
  at: { x: number; y: number },
  params?: CanvasNodeParams,
): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const node = await api.addCanvasNode(id, { type, x: at.x, y: at.y, params });
  applyEvent(sessionId, { type: 'node_added', node });
}

export async function duplicateNode(sessionId: string, nodeId: string): Promise<void> {
  const source = nodeById(sessionId, nodeId);
  const id = canvasId(sessionId);
  if (!source || !id) return;
  const node = await api.addCanvasNode(id, {
    type: source.type,
    x: source.x + 32,
    y: source.y + 32,
    title: source.title,
    params: source.params,
  });
  applyEvent(sessionId, { type: 'node_added', node });
}

export function moveNode(sessionId: string, nodeId: string, x: number, y: number): void {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)));
  const id = canvasId(sessionId);
  if (!id) return;
  const key = `${sessionId}:${nodeId}`;
  const prev = moveTimers.get(key);
  if (prev) clearTimeout(prev);
  moveTimers.set(
    key,
    setTimeout(() => {
      moveTimers.delete(key);
      void api.patchCanvasNode(id, nodeId, { x: Math.round(x), y: Math.round(y) }).catch((): void => undefined);
    }, 250),
  );
}

export function resizeNode(sessionId: string, nodeId: string, w: number, h: number): void {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, w, h } : n)));
  const id = canvasId(sessionId);
  if (!id) return;
  const key = `${sessionId}:${nodeId}:size`;
  const prev = moveTimers.get(key);
  if (prev) clearTimeout(prev);
  moveTimers.set(
    key,
    setTimeout(() => {
      moveTimers.delete(key);
      void api.patchCanvasNode(id, nodeId, { w: Math.round(w), h: Math.round(h) }).catch((): void => undefined);
    }, 250),
  );
}

export async function updateNodeParams(
  sessionId: string,
  nodeId: string,
  params: CanvasNodeParams,
): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, params } : n)));
  const id = canvasId(sessionId);
  if (!id) return;
  await api.patchCanvasNode(id, nodeId, { params }).catch((): void => undefined);
}

export async function removeNode(sessionId: string, nodeId: string): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.filter((n) => n.id !== nodeId));
  const id = canvasId(sessionId);
  if (!id) return;
  await api.deleteCanvasNode(id, nodeId).catch((): void => undefined);
}

/** Throws with a readable message when the server rejects the connection. */
export async function connectNodes(sessionId: string, sourceId: string, targetId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id || sourceId === targetId) return;
  const edge = await api.addCanvasEdge(id, { sourceId, targetId });
  applyEvent(sessionId, { type: 'edge_added', edge });
}

export async function removeEdge(sessionId: string, edgeId: string): Promise<void> {
  const edges = state.edgesBySession[sessionId] ?? [];
  setEdges(sessionId, edges.filter((e) => e.id !== edgeId));
  const id = canvasId(sessionId);
  if (!id) return;
  await api.deleteCanvasEdge(id, edgeId).catch((): void => undefined);
}

export async function runNode(sessionId: string, nodeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  await api.runCanvasNode(id, nodeId, { confirmedSpend: true });
}

export async function runGraph(sessionId: string, from?: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  await api.runCanvasGraph(id, { confirmedSpend: true, from });
}

export async function stopGraph(sessionId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  await api.stopCanvasGraph(id).catch((): void => undefined);
}

export async function importImage(
  sessionId: string,
  file: File,
  at: { x: number; y: number },
): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const node = await api.importCanvasImage(id, {
    name: file.name || 'image.png',
    dataBase64: btoa(binary),
    x: at.x,
    y: at.y,
  });
  applyEvent(sessionId, { type: 'node_added', node });
}

export async function saveAsset(sessionId: string, nodeId: string, assetIndex = 0): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  await api.saveCanvasAsset(id, nodeId, assetIndex);
}

export function setSelection(sessionId: string, ids: string[]): void {
  const id = canvasId(sessionId);
  if (!id) return;
  const prev = selectionTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  selectionTimers.set(
    sessionId,
    setTimeout(() => {
      selectionTimers.delete(sessionId);
      void api.setCanvasSelection(id, ids).catch((): void => undefined);
    }, 300),
  );
}

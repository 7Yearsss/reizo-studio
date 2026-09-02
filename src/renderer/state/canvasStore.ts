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
  /** Node the agent just touched — the canvas pans to it briefly. */
  focusBySession: Record<string, { id: string; at: number } | undefined>;
  historyBySession: Record<string, { canUndo: boolean; canRedo: boolean }>;
}

let state: CanvasState = {
  canvasIdBySession: {},
  nodesBySession: {},
  edgesBySession: {},
  loadedBySession: {},
  graphRunBySession: {},
  focusBySession: {},
  historyBySession: {},
};

const listeners = new Set<() => void>();
const streamAborts = new Map<string, AbortController>();
const lastRevBySession = new Map<string, number>();
const selectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface HistoryEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}
const historyStacks = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();
const HISTORY_CAP = 60;

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

function stacksFor(sessionId: string) {
  let s = historyStacks.get(sessionId);
  if (!s) {
    s = { undo: [], redo: [] };
    historyStacks.set(sessionId, s);
  }
  return s;
}

function syncHistoryFlags(sessionId: string): void {
  const s = stacksFor(sessionId);
  setState({
    historyBySession: {
      ...state.historyBySession,
      [sessionId]: { canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 },
    },
  });
}

function record(sessionId: string, entry: HistoryEntry): void {
  const s = stacksFor(sessionId);
  s.undo.push(entry);
  if (s.undo.length > HISTORY_CAP) s.undo.shift();
  s.redo.length = 0;
  syncHistoryFlags(sessionId);
}

export async function undo(sessionId: string): Promise<void> {
  const s = stacksFor(sessionId);
  const entry = s.undo.pop();
  if (!entry) return;
  s.redo.push(entry);
  syncHistoryFlags(sessionId);
  await entry.undo().catch((): void => undefined);
}

export async function redo(sessionId: string): Promise<void> {
  const s = stacksFor(sessionId);
  const entry = s.redo.pop();
  if (!entry) return;
  s.undo.push(entry);
  syncHistoryFlags(sessionId);
  await entry.redo().catch((): void => undefined);
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

export function focusNode(sessionId: string, nodeId: string): void {
  if (!nodeById(sessionId, nodeId)) return;
  setState({ focusBySession: { ...state.focusBySession, [sessionId]: { id: nodeId, at: Date.now() } } });
}

// --- internal mutations (no history) ---

async function _addNode(
  sessionId: string,
  spec: { type: 'image' | 'agent'; x: number; y: number; title?: string; params?: CanvasNodeParams },
): Promise<string | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const node = await api.addCanvasNode(id, spec);
  applyEvent(sessionId, { type: 'node_added', node });
  return node.id;
}

async function _deleteNode(sessionId: string, nodeId: string): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.filter((n) => n.id !== nodeId));
  setEdges(
    sessionId,
    (state.edgesBySession[sessionId] ?? []).filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId),
  );
  const id = canvasId(sessionId);
  if (id) await api.deleteCanvasNode(id, nodeId).catch((): void => undefined);
}

async function _setPosition(sessionId: string, nodeId: string, x: number, y: number): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)));
  const id = canvasId(sessionId);
  if (id) await api.patchCanvasNode(id, nodeId, { x: Math.round(x), y: Math.round(y) }).catch((): void => undefined);
}

async function _setSize(sessionId: string, nodeId: string, w: number, h: number): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, w, h } : n)));
  const id = canvasId(sessionId);
  if (id) await api.patchCanvasNode(id, nodeId, { w: Math.round(w), h: Math.round(h) }).catch((): void => undefined);
}

async function _setNode(
  sessionId: string,
  nodeId: string,
  patch: { params?: CanvasNodeParams; title?: string },
): Promise<void> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
  const id = canvasId(sessionId);
  if (id) await api.patchCanvasNode(id, nodeId, patch).catch((): void => undefined);
}

async function _addEdge(sessionId: string, sourceId: string, targetId: string): Promise<string | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const edge = await api.addCanvasEdge(id, { sourceId, targetId });
  applyEvent(sessionId, { type: 'edge_added', edge });
  return edge.id;
}

async function _deleteEdge(sessionId: string, edgeId: string): Promise<void> {
  setEdges(sessionId, (state.edgesBySession[sessionId] ?? []).filter((e) => e.id !== edgeId));
  const id = canvasId(sessionId);
  if (id) await api.deleteCanvasEdge(id, edgeId).catch((): void => undefined);
}

// --- public mutations (with history) ---

export async function addNode(
  sessionId: string,
  type: 'image' | 'agent',
  at: { x: number; y: number },
  params?: CanvasNodeParams,
): Promise<void> {
  const spec = { type, x: at.x, y: at.y, params };
  let currentId = await _addNode(sessionId, spec);
  if (!currentId) return;
  record(sessionId, {
    undo: () => (currentId ? _deleteNode(sessionId, currentId) : Promise.resolve()),
    redo: async () => {
      currentId = await _addNode(sessionId, spec);
    },
  });
}

export async function duplicateNode(sessionId: string, nodeId: string): Promise<void> {
  const source = nodeById(sessionId, nodeId);
  if (!source) return;
  const spec = {
    type: source.type,
    x: source.x + 32,
    y: source.y + 32,
    title: source.title,
    params: source.params,
  };
  let currentId = await _addNode(sessionId, spec);
  if (!currentId) return;
  record(sessionId, {
    undo: () => (currentId ? _deleteNode(sessionId, currentId) : Promise.resolve()),
    redo: async () => {
      currentId = await _addNode(sessionId, spec);
    },
  });
}

export async function removeNode(sessionId: string, nodeId: string): Promise<void> {
  const node = nodeById(sessionId, nodeId);
  if (!node) return;
  const touching = (state.edgesBySession[sessionId] ?? []).filter(
    (e) => e.sourceId === nodeId || e.targetId === nodeId,
  );
  const spec = { type: node.type, x: node.x, y: node.y, title: node.title, params: node.params };
  let recreatedId = nodeId;
  await _deleteNode(sessionId, nodeId);
  record(sessionId, {
    undo: async () => {
      const newId = await _addNode(sessionId, spec);
      if (!newId) return;
      recreatedId = newId;
      for (const e of touching) {
        const src = e.sourceId === nodeId ? newId : e.sourceId;
        const tgt = e.targetId === nodeId ? newId : e.targetId;
        if (nodeById(sessionId, src) && nodeById(sessionId, tgt)) {
          await _addEdge(sessionId, src, tgt).catch((): null => null);
        }
      }
    },
    redo: () => _deleteNode(sessionId, recreatedId),
  });
}

/** Records one history entry for a whole drag gesture. */
export function commitMove(sessionId: string, nodeId: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (from.x === to.x && from.y === to.y) return;
  void _setPosition(sessionId, nodeId, to.x, to.y);
  record(sessionId, {
    undo: () => _setPosition(sessionId, nodeId, from.x, from.y),
    redo: () => _setPosition(sessionId, nodeId, to.x, to.y),
  });
}

/** Live position during a drag — no API call, no history (commitMove does both). */
export function moveNodeLive(sessionId: string, nodeId: string, x: number, y: number): void {
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(sessionId, nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)));
}

export function commitResize(
  sessionId: string,
  nodeId: string,
  from: { w: number; h: number },
  to: { w: number; h: number },
): void {
  if (from.w === to.w && from.h === to.h) return;
  void _setSize(sessionId, nodeId, to.w, to.h);
  record(sessionId, {
    undo: () => _setSize(sessionId, nodeId, from.w, from.h),
    redo: () => _setSize(sessionId, nodeId, to.w, to.h),
  });
}

export async function updateNodeParams(
  sessionId: string,
  nodeId: string,
  params: CanvasNodeParams,
): Promise<void> {
  const before = nodeById(sessionId, nodeId)?.params;
  await _setNode(sessionId, nodeId, { params });
  if (before === undefined) return;
  record(sessionId, {
    undo: () => _setNode(sessionId, nodeId, { params: before }),
    redo: () => _setNode(sessionId, nodeId, { params }),
  });
}

export async function renameNode(sessionId: string, nodeId: string, title: string): Promise<void> {
  const before = nodeById(sessionId, nodeId)?.title ?? '';
  if (before === title) return;
  await _setNode(sessionId, nodeId, { title });
  record(sessionId, {
    undo: () => _setNode(sessionId, nodeId, { title: before }),
    redo: () => _setNode(sessionId, nodeId, { title }),
  });
}

/** Throws with a readable message when the server rejects the connection. */
export async function connectNodes(sessionId: string, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) return;
  const edgeId = await _addEdge(sessionId, sourceId, targetId);
  if (!edgeId) return;
  record(sessionId, {
    undo: () => _deleteEdge(sessionId, edgeId),
    redo: async () => {
      await _addEdge(sessionId, sourceId, targetId).catch((): null => null);
    },
  });
}

export async function removeEdge(sessionId: string, edgeId: string): Promise<void> {
  const edge = (state.edgesBySession[sessionId] ?? []).find((e) => e.id === edgeId);
  if (!edge) return;
  await _deleteEdge(sessionId, edgeId);
  record(sessionId, {
    undo: async () => {
      await _addEdge(sessionId, edge.sourceId, edge.targetId).catch((): null => null);
    },
    redo: async () => {
      const again = (state.edgesBySession[sessionId] ?? []).find(
        (e) => e.sourceId === edge.sourceId && e.targetId === edge.targetId,
      );
      if (again) await _deleteEdge(sessionId, again.id);
    },
  });
}

/** Batch reposition (auto-layout) — one history entry for the lot. */
export function applyLayout(sessionId: string, positions: Record<string, { x: number; y: number }>): void {
  const before: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    const n = nodeById(sessionId, id);
    if (!n) continue;
    before[id] = { x: n.x, y: n.y };
    void _setPosition(sessionId, id, pos.x, pos.y);
  }
  const apply = (map: Record<string, { x: number; y: number }>) => async () => {
    for (const [id, pos] of Object.entries(map)) await _setPosition(sessionId, id, pos.x, pos.y);
  };
  record(sessionId, { undo: apply(before), redo: apply(positions) });
}

// --- runs (not undoable) ---

export async function runNode(sessionId: string, nodeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.runCanvasNode(id, nodeId, { confirmedSpend: true });
}

export async function runGraph(sessionId: string, from?: string): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.runCanvasGraph(id, { confirmedSpend: true, from });
}

export async function stopGraph(sessionId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.stopCanvasGraph(id).catch((): void => undefined);
}

export async function importImage(sessionId: string, file: File, at: { x: number; y: number }): Promise<void> {
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
  record(sessionId, {
    undo: () => _deleteNode(sessionId, node.id),
    redo: () => Promise.resolve(), // imported bytes are gone from the drop event
  });
}

export async function saveAsset(sessionId: string, nodeId: string, assetIndex = 0): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.saveCanvasAsset(id, nodeId, assetIndex);
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

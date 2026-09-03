import * as api from '../api';
import type { CanvasNode, CanvasEdge, CanvasNodeParams, CanvasNodeType, CanvasSnapshot, CanvasGroupParams } from '../../shared/canvas';
import { gridArrange } from '../../shared/arrangeNodes';
import { grabVideoFrameBlob, type FramePick } from '../lib/videoFrame';
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
  spec: {
    type: CanvasNodeType;
    x: number;
    y: number;
    w?: number;
    h?: number;
    title?: string;
    params?: CanvasNodeParams;
  },
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

async function _addEdge(
  sessionId: string,
  sourceId: string,
  targetId: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): Promise<string | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const edge = await api.addCanvasEdge(id, { sourceId, targetId, sourceHandle, targetHandle });
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
  type: CanvasNodeType,
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

export async function forkNode(sessionId: string, nodeId: string): Promise<string | null> {
  const source = nodeById(sessionId, nodeId);
  if (!source) return null;
  const spec = {
    type: source.type,
    x: source.x + source.w + 32,
    y: source.y,
    title: source.title ? `${source.title} (变体)` : `${source.type === 'image' ? '图片' : 'Agent'} (变体)`,
    params: { ...(source.params as Record<string, unknown>) },
  };
  const newId = await _addNode(sessionId, spec);
  if (!newId) return null;

  const edges = state.edgesBySession[sessionId] ?? [];
  const incoming = edges.filter((e) => e.targetId === nodeId);
  for (const edge of incoming) {
    await _addEdge(sessionId, edge.sourceId, newId);
  }

  record(sessionId, {
    undo: () => (newId ? _deleteNode(sessionId, newId) : Promise.resolve()),
    redo: async () => {
      const recreated = await _addNode(sessionId, spec);
      if (recreated) {
        for (const edge of incoming) {
          await _addEdge(sessionId, edge.sourceId, recreated);
        }
      }
    },
  });

  return newId;
}

export async function addDownstreamAgent(
  sessionId: string,
  sourceId: string,
  instruction = '请评估该图片，从画面构图、细节与质感给出点评，并提供优化后的 Prompt 建议。',
): Promise<string | null> {
  const source = nodeById(sessionId, sourceId);
  if (!source) return null;
  const spec = {
    type: 'agent' as const,
    x: source.x + source.w + 40,
    y: source.y,
    title: '画面质检',
    params: { instruction },
  };
  const agentId = await _addNode(sessionId, spec);
  if (!agentId) return null;
  await _addEdge(sessionId, sourceId, agentId);

  record(sessionId, {
    undo: () => (agentId ? _deleteNode(sessionId, agentId) : Promise.resolve()),
    redo: async () => {
      const id = await _addNode(sessionId, spec);
      if (id) await _addEdge(sessionId, sourceId, id);
    },
  });
  return agentId;
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

/**
 * Records ONE history entry for a multi-node drag gesture (e.g. dragging a
 * group container carries its members along). Positions are already live in
 * the store — this persists them and makes the whole gesture one undo step.
 */
export function commitMoveBatch(
  sessionId: string,
  moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[],
): void {
  const real = moves.filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y);
  if (real.length === 0) return;
  if (real.length === 1) {
    commitMove(sessionId, real[0].id, real[0].from, real[0].to);
    return;
  }
  const apply = (pick: 'from' | 'to') => async () => {
    for (const m of real) await _setPosition(sessionId, m.id, m[pick].x, m[pick].y);
  };
  void apply('to')();
  record(sessionId, { undo: apply('from'), redo: apply('to') });
}

/** The group node whose `memberIds` contain `nodeId`, if any. */
export function groupOf(sessionId: string, nodeId: string): CanvasNode | undefined {
  return (state.nodesBySession[sessionId] ?? []).find(
    (n) => n.type === 'group' && ((n.params as CanvasGroupParams).memberIds ?? []).includes(nodeId),
  );
}

/** Member ids of a group node (empty for anything else). */
export function groupMemberIds(sessionId: string, groupId: string): string[] {
  const group = nodeById(sessionId, groupId);
  if (!group || group.type !== 'group') return [];
  return ((group.params as CanvasGroupParams).memberIds ?? []).filter((id) =>
    nodeById(sessionId, id),
  );
}

/** Ids of every node that sits inside a *locked* group — these must not move. */
export function lockedMemberIds(sessionId: string): Set<string> {
  const out = new Set<string>();
  for (const n of state.nodesBySession[sessionId] ?? []) {
    if (n.type !== 'group') continue;
    const params = n.params as CanvasGroupParams;
    if (!params.locked) continue;
    for (const id of params.memberIds ?? []) out.add(id);
  }
  return out;
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
export async function connectNodes(
  sessionId: string,
  sourceId: string,
  targetId: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): Promise<void> {
  if (sourceId === targetId) return;
  const edgeId = await _addEdge(sessionId, sourceId, targetId, sourceHandle, targetHandle);
  if (!edgeId) return;
  record(sessionId, {
    undo: () => _deleteEdge(sessionId, edgeId),
    redo: async () => {
      await _addEdge(sessionId, sourceId, targetId, sourceHandle, targetHandle).catch((): null => null);
    },
  });
}

export async function addNodeAndConnect(
  sessionId: string,
  spec: { type: CanvasNodeType; x: number; y: number; title?: string; params?: CanvasNodeParams },
  sourceId: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): Promise<string | null> {
  const newNodeId = await _addNode(sessionId, spec);
  if (!newNodeId) return null;
  const edgeId = await _addEdge(sessionId, sourceId, newNodeId, sourceHandle, targetHandle);
  record(sessionId, {
    undo: async () => {
      if (edgeId) await _deleteEdge(sessionId, edgeId);
      await _deleteNode(sessionId, newNodeId);
    },
    redo: async () => {
      const recreated = await _addNode(sessionId, spec);
      if (recreated) {
        await _addEdge(sessionId, sourceId, recreated, sourceHandle, targetHandle).catch((): null => null);
      }
    },
  });
  return newNodeId;
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

/** Container box that wraps `members`, leaving room for the group header bar. */
const GROUP_PADDING = 28;
const GROUP_HEADER = 42;

function groupBox(members: CanvasNode[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return {
    x: Math.round(minX - GROUP_PADDING),
    y: Math.round(minY - GROUP_HEADER),
    w: Math.round(maxX - minX + GROUP_PADDING * 2),
    h: Math.round(maxY - minY + GROUP_HEADER + GROUP_PADDING),
  };
}

export async function groupNodes(
  sessionId: string,
  memberIds: string[],
): Promise<string | null> {
  const nodes = (state.nodesBySession[sessionId] ?? []).filter(
    (n) => memberIds.includes(n.id) && n.type !== 'group',
  );
  if (nodes.length === 0) return null;

  const spec = {
    type: 'group' as const,
    ...groupBox(nodes),
    title: '分镜组',
    params: { memberIds: nodes.map((n) => n.id), color: '#3b82f6', locked: false },
  };

  let currentId = await _addNode(sessionId, spec);
  if (!currentId) return null;

  record(sessionId, {
    undo: () => (currentId ? _deleteNode(sessionId, currentId) : Promise.resolve()),
    redo: async () => {
      currentId = await _addNode(sessionId, spec);
    },
  });

  return currentId;
}

export async function ungroupNodes(sessionId: string, groupId: string): Promise<void> {
  const group = nodeById(sessionId, groupId);
  if (!group || group.type !== 'group') return;
  const spec = {
    type: 'group' as const,
    x: group.x,
    y: group.y,
    w: group.w,
    h: group.h,
    title: group.title,
    params: group.params,
  };
  let recreatedId = groupId;
  await _deleteNode(sessionId, groupId);
  record(sessionId, {
    undo: async () => {
      const id = await _addNode(sessionId, spec);
      if (id) recreatedId = id;
    },
    redo: () => _deleteNode(sessionId, recreatedId),
  });
}

/**
 * Grid-align the selection. A `group` node in the selection is not arranged as
 * a peer — its members are arranged inside it instead, and the container is
 * refitted afterwards. Emits a single history entry via `applyLayout`.
 */
export async function arrangeSelectedNodes(sessionId: string, nodeIds: string[]): Promise<void> {
  const all = state.nodesBySession[sessionId] ?? [];
  const picked = all.filter((n) => nodeIds.includes(n.id));
  const groups = picked.filter((n) => n.type === 'group');

  // Selecting a single group means "tidy up inside this group".
  if (groups.length === 1 && picked.length === 1) {
    const group = groups[0];
    const members = groupMemberIds(sessionId, group.id)
      .map((id) => nodeById(sessionId, id))
      .filter((n): n is CanvasNode => Boolean(n));
    if (members.length < 2) return;
    applyLayout(
      sessionId,
      gridArrange(members, {
        center: { x: group.x + group.w / 2, y: group.y + group.h / 2 },
      }),
    );
    void refitGroup(sessionId, group.id);
    return;
  }

  const targets = picked.filter((n) => n.type !== 'group');
  if (targets.length < 2) return;
  applyLayout(sessionId, gridArrange(targets));
  // Any group that owns one of the moved nodes needs to grow/shrink to match.
  const touched = new Set<string>();
  for (const t of targets) {
    const g = groupOf(sessionId, t.id);
    if (g) touched.add(g.id);
  }
  for (const gid of touched) void refitGroup(sessionId, gid);
}

/** Grow / shrink a group container so it wraps its current members. */
export async function refitGroup(sessionId: string, groupId: string): Promise<void> {
  const group = nodeById(sessionId, groupId);
  if (!group || group.type !== 'group') return;
  const members = groupMemberIds(sessionId, groupId)
    .map((id) => nodeById(sessionId, id))
    .filter((n): n is CanvasNode => Boolean(n));
  if (members.length === 0) return;
  const box = groupBox(members);
  const nodes = state.nodesBySession[sessionId] ?? [];
  setNodes(
    sessionId,
    nodes.map((n) => (n.id === groupId ? { ...n, ...box } : n)),
  );
  const id = canvasId(sessionId);
  if (id) await api.patchCanvasNode(id, groupId, box).catch((): void => undefined);
}

export async function duplicateSelectedNodes(sessionId: string, nodeIds: string[]): Promise<string[]> {
  const nodes = (state.nodesBySession[sessionId] ?? []).filter((n) => nodeIds.includes(n.id));
  if (nodes.length === 0) return [];

  const oldToNew = new Map<string, string>();
  const createdIds: string[] = [];
  const createdEdgeIds: string[] = [];

  for (const n of nodes) {
    const spec = {
      type: n.type,
      x: n.x + 36,
      y: n.y + 36,
      w: n.w,
      h: n.h,
      title: n.title ? `${n.title} (副本)` : undefined,
      params: n.params,
    };
    const newId = await _addNode(sessionId, spec);
    if (newId) {
      oldToNew.set(n.id, newId);
      createdIds.push(newId);
    }
  }

  // Clone internal edges between selected nodes
  const edges = state.edgesBySession[sessionId] ?? [];
  const internalEdges = edges.filter((e) => oldToNew.has(e.sourceId) && oldToNew.has(e.targetId));
  for (const edge of internalEdges) {
    const newSource = oldToNew.get(edge.sourceId)!;
    const newTarget = oldToNew.get(edge.targetId)!;
    const newEdgeId = await _addEdge(
      sessionId,
      newSource,
      newTarget,
      edge.sourceHandle ?? undefined,
      edge.targetHandle ?? undefined,
    );
    if (newEdgeId) createdEdgeIds.push(newEdgeId);
  }

  record(sessionId, {
    undo: async () => {
      for (const eId of createdEdgeIds) await _deleteEdge(sessionId, eId);
      for (const nId of createdIds) await _deleteNode(sessionId, nId);
    },
    redo: async () => {
      await duplicateSelectedNodes(sessionId, nodeIds);
    },
  });

  return createdIds;
}

// --- runs (not undoable) ---

export async function runNode(sessionId: string, nodeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.runCanvasNode(id, nodeId, { confirmedSpend: true });
}

export async function runGraph(sessionId: string, from?: string, nodeIds?: string[]): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.runCanvasGraph(id, { confirmedSpend: true, from, nodeIds });
}

export async function runGroup(sessionId: string, groupId: string): Promise<void> {
  const group = nodeById(sessionId, groupId);
  if (!group || group.type !== 'group') return;
  const params = group.params as CanvasGroupParams;
  const memberIds = params.memberIds || [];
  if (memberIds.length === 0) return;
  await runGraph(sessionId, undefined, memberIds);
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

/**
 * Grab a still frame from a finished `video` node and drop it on the canvas as
 * a `done` image node, wired `video -> image` for provenance. That image can
 * then be fed into the next video's start/end-frame handle for seamless
 * shot-to-shot continuation. One undo step removes both the node and the edge.
 *
 * `pick`: 'start' | 'end' grab the first / last frame; 'current' grabs the
 * frame at `currentTime` (seconds) of the player the user is scrubbing.
 */
export async function extractVideoFrame(
  sessionId: string,
  videoNodeId: string,
  pick: FramePick,
  currentTime = 0,
  assetIndex = 0,
): Promise<string | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const source = nodeById(sessionId, videoNodeId);
  if (!source || source.type !== 'video') return null;
  const assets = source.output?.assets ?? [];
  const rel = assets[Math.min(assetIndex, assets.length - 1)] ?? assets[0];
  if (!rel) return null;

  const httpUrl = await api.canvasAssetUrl(rel);
  const blob = await grabVideoFrameBlob(httpUrl, pick, currentTime);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

  const label = pick === 'start' ? '镜头首帧' : pick === 'end' ? '镜头尾帧' : '镜头选帧';
  const yOffset = pick === 'start' ? 0 : pick === 'end' ? 80 : 160;

  const node = await api.importCanvasImage(id, {
    name: label,
    dataBase64: btoa(binary),
    x: Math.round(source.x + source.w + 56),
    y: Math.round(source.y + yOffset),
  });
  applyEvent(sessionId, { type: 'node_added', node });

  const edgeId = await _addEdge(sessionId, videoNodeId, node.id).catch((): null => null);

  record(sessionId, {
    undo: async () => {
      if (edgeId) await _deleteEdge(sessionId, edgeId);
      await _deleteNode(sessionId, node.id);
    },
    redo: () => Promise.resolve(), // the decoded frame bytes are not retained
  });

  return node.id;
}

export async function saveAsset(sessionId: string, nodeId: string, assetIndex = 0): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.saveCanvasAsset(id, nodeId, assetIndex);
}

/** Download the current canvas as a portable `.reizo.zip`. */
export async function exportWorkflow(sessionId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const blob = await api.exportCanvasWorkflow(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reizo-canvas-${new Date().toISOString().slice(0, 10)}.reizo.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Merge a `.reizo.zip` into the current canvas. The server assigns fresh ids
 * and streams the new nodes/edges in; we register one history entry so the
 * whole import undoes in a single Ctrl+Z.
 */
export async function importWorkflow(
  sessionId: string,
  file: File,
): Promise<{ warnings: string[]; count: number }> {
  const id = canvasId(sessionId);
  if (!id) return { warnings: [], count: 0 };
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const res = await api.importCanvasWorkflow(id, btoa(binary));
  const createdIds = res.nodeIds ?? [];
  if (createdIds.length > 0) {
    record(sessionId, {
      undo: async () => {
        for (const nid of createdIds) await _deleteNode(sessionId, nid);
      },
      redo: () => Promise.resolve(), // decoded zip bytes are not retained
    });
  }
  return { warnings: res.warnings ?? [], count: createdIds.length };
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

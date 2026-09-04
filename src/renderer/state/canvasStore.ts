import * as api from '../api';
import type {
  CanvasNode,
  CanvasEdge,
  CanvasNodeParams,
  CanvasNodeType,
  CanvasSnapshot,
  CanvasGroupParams,
  CanvasFrameExtractorParams,
  CanvasSectionParams,
  CanvasSubgraphParams,
} from '../../shared/canvas';
import { gridArrange } from '../../shared/arrangeNodes';
import { variantGrid } from '../../shared/variantLayout';
import type { AgentTrailEntry } from '../../shared/agentTrail';
import { grabVideoFrameBlob, type FramePick } from '../lib/videoFrame';
import { notifyJobDone, primeNotifications } from '../lib/notify';
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
  /** Node(s) the agent just touched — the canvas pans / fits to them briefly. */
  spotlightBySession: Record<string, { ids: string[]; at: number } | undefined>;
  /** Recent agent canvas writes (newest last), derived from chat tool events. */
  trailBySession: Record<string, AgentTrailEntry[]>;
  historyBySession: Record<string, { canUndo: boolean; canRedo: boolean }>;
  /** When true, canvas nodes hide form widgets and show pure media. */
  moodboardBySession: Record<string, boolean>;
  /** Node(s) currently in Agent proposal diff state (rendered with glowing dashed border). */
  proposalsBySession: Record<string, string[]>;
}

export const EMPTY_NODES: CanvasNode[] = [];
export const EMPTY_EDGES: CanvasEdge[] = [];
export const EMPTY_PROPOSALS: string[] = [];
export const EMPTY_TRAIL: AgentTrailEntry[] = [];

const TRAIL_CAP = 30;

let state: CanvasState = {
  canvasIdBySession: {},
  nodesBySession: {},
  edgesBySession: {},
  loadedBySession: {},
  graphRunBySession: {},
  spotlightBySession: {},
  trailBySession: {},
  historyBySession: {},
  moodboardBySession: {},
  proposalsBySession: {},
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

export function edgesForSession(sessionId: string): CanvasEdge[] {
  return state.edgesBySession[sessionId] ?? [];
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
      // A single node finishing (done/error) outside a graph run, while the app
      // is unfocused, is worth an OS ping — batch runs get their own below.
      if (event.type !== 'node_updated' && !state.graphRunBySession[sessionId]?.running) {
        const prev = nodes.find((n) => n.id === event.id);
        if (prev?.runState === 'running' && (event.runState === 'done' || event.runState === 'error')) {
          const label = prev.title || (prev.type === 'video' ? '视频' : prev.type === 'image' ? '图片' : '节点');
          notifyJobDone(
            event.runState === 'done' ? '生成完成' : '生成失败',
            event.runState === 'done' ? `「${label}」已就绪` : `「${label}」运行失败`,
          );
        }
      }
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
    case 'graph_run': {
      const wasRunning = state.graphRunBySession[sessionId]?.running ?? false;
      if (wasRunning && !event.running) {
        notifyJobDone('画布流水线完成', `已生成 ${event.total} 个节点`);
      }
      setState({
        graphRunBySession: {
          ...state.graphRunBySession,
          [sessionId]: event.running ? { running: true, done: event.done, total: event.total } : undefined,
        },
      });
      break;
    }
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
  primeNotifications();
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

/** Pan (single) or fit (multi) the canvas to these nodes with a brief pulse. */
export function spotlight(sessionId: string, ids: string[]): void {
  const present = ids.filter((id) => nodeById(sessionId, id));
  if (present.length === 0) return;
  setState({
    spotlightBySession: { ...state.spotlightBySession, [sessionId]: { ids: present, at: Date.now() } },
  });
}

/** Back-compat thin wrapper — existing callers pass one id. */
export function focusNode(sessionId: string, nodeId: string): void {
  spotlight(sessionId, [nodeId]);
}

/**
 * Record one agent canvas write in the activity trail (deduped by tool-call id,
 * newest last, capped). Reads (`trailEntryFromTool` returns null for those)
 * never reach here. Does NOT touch the undo stack — that's `recordAgentBatch`.
 */
export function pushTrail(sessionId: string, entry: AgentTrailEntry): void {
  const list = state.trailBySession[sessionId] ?? [];
  const next = list.filter((e) => e.id !== entry.id);
  next.push(entry);
  setState({
    trailBySession: {
      ...state.trailBySession,
      [sessionId]: next.slice(-TRAIL_CAP),
    },
  });
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
    await _addEdge(sessionId, edge.sourceId, newId, edge.sourceHandle, edge.targetHandle);
  }

  record(sessionId, {
    undo: () => (newId ? _deleteNode(sessionId, newId) : Promise.resolve()),
    redo: async () => {
      const recreated = await _addNode(sessionId, spec);
      if (recreated) {
        for (const edge of incoming) {
          await _addEdge(sessionId, edge.sourceId, recreated, edge.sourceHandle, edge.targetHandle);
        }
      }
    },
  });

  return newId;
}

/** Human label a fork/variant title is built from. */
function forkBaseTitle(node: CanvasNode): string {
  if (node.title) return node.title;
  if (node.type === 'image') return '图片';
  if (node.type === 'video') return '视频';
  if (node.type === 'agent') return 'Agent';
  return node.type;
}

/**
 * Fork `count` sibling variants of a node — same params, same incoming edges
 * (handles preserved) — laid out as a grid to the right that dodges every
 * existing node. The whole batch is one history entry.
 */
export async function forkVariations(
  sessionId: string,
  nodeId: string,
  count = 4,
): Promise<string[]> {
  const source = nodeById(sessionId, nodeId);
  if (!source) return [];

  const nodes = state.nodesBySession[sessionId] ?? [];
  const edges = state.edgesBySession[sessionId] ?? [];
  const incoming = edges.filter((e) => e.targetId === nodeId);
  const positions = variantGrid(
    { x: source.x, y: source.y, w: source.w, h: source.h },
    count,
    nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
  );
  const base = forkBaseTitle(source);
  const specs = positions.map((pos, i) => ({
    type: source.type,
    x: pos.x,
    y: pos.y,
    w: source.w,
    h: source.h,
    title: `${base} (变体 ${i + 1})`,
    params: { ...(source.params as Record<string, unknown>) },
  }));

  const create = async (): Promise<string[]> => {
    const made: string[] = [];
    for (const spec of specs) {
      const id = await _addNode(sessionId, spec);
      if (!id) continue;
      made.push(id);
      for (const edge of incoming) {
        await _addEdge(sessionId, edge.sourceId, id, edge.sourceHandle, edge.targetHandle);
      }
    }
    return made;
  };

  let ids = await create();
  if (ids.length === 0) return [];
  record(sessionId, {
    undo: async () => {
      for (const id of ids) await _deleteNode(sessionId, id);
    },
    redo: async () => {
      ids = await create();
    },
  });
  return ids;
}

/**
 * Fork one variant of each selected node as a single history entry — the
 * multi-select toolbar's "batch fork" (was N separate undo steps).
 */
export async function forkSelected(sessionId: string, nodeIds: string[]): Promise<string[]> {
  const plans = nodeIds
    .map((id) => {
      const source = nodeById(sessionId, id);
      if (!source) return null;
      const edges = state.edgesBySession[sessionId] ?? [];
      return {
        incoming: edges.filter((e) => e.targetId === id),
        spec: {
          type: source.type,
          x: source.x + source.w + 32,
          y: source.y,
          w: source.w,
          h: source.h,
          title: `${forkBaseTitle(source)} (变体)`,
          params: { ...(source.params as Record<string, unknown>) },
        },
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (plans.length === 0) return [];

  const create = async (): Promise<string[]> => {
    const made: string[] = [];
    for (const plan of plans) {
      const id = await _addNode(sessionId, plan.spec);
      if (!id) continue;
      made.push(id);
      for (const edge of plan.incoming) {
        await _addEdge(sessionId, edge.sourceId, id, edge.sourceHandle, edge.targetHandle);
      }
    }
    return made;
  };

  let ids = await create();
  if (ids.length === 0) return [];
  record(sessionId, {
    undo: async () => {
      for (const id of ids) await _deleteNode(sessionId, id);
    },
    redo: async () => {
      ids = await create();
    },
  });
  return ids;
}

const agentBatchRecorded = new Set<string>();

/**
 * P0-2 — put one agent structural tool-call into the renderer undo stack so
 * `Ctrl+Z` undoes the whole batch (13 storyboard nodes = one undo).
 *
 * The tool result and the `node_added` / `edge_added` channel events are two
 * separate streams, so the batch's nodes may not be in `state` yet. We check;
 * if some are missing we retry once after a beat and record only what arrived
 * — never block, never poll.
 *
 * `redo` rebuilds via `_addNode` / `_addEdge` (fresh ids, closure refreshed —
 * same pattern as `forkVariations`). The agent-trail entry then points at stale
 * ids; the activity strip greys that row rather than erroring.
 */
export function recordAgentBatch(sessionId: string, entry: AgentTrailEntry): void {
  if (agentBatchRecorded.has(entry.id)) return;

  const attempt = (retriesLeft: number): void => {
    const present = entry.nodeIds.filter((id) => nodeById(sessionId, id));
    if (present.length < entry.nodeIds.length && retriesLeft > 0) {
      setTimeout(() => attempt(retriesLeft - 1), 120);
      return;
    }
    if (present.length === 0) return;
    agentBatchRecorded.add(entry.id);

    const idSet = new Set(present);
    const nodeSpecs = present
      .map((id) => nodeById(sessionId, id))
      .filter((n): n is CanvasNode => Boolean(n))
      .map((n) => ({
        type: n.type,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        title: n.title,
        params: n.params as CanvasNodeParams,
      }));
    // Any edge that touches the batch — inner edges and edges to outside nodes.
    const edgeSpecs = (state.edgesBySession[sessionId] ?? [])
      .filter((e) => idSet.has(e.sourceId) || idSet.has(e.targetId))
      .map((e) => ({
        sourceId: e.sourceId,
        targetId: e.targetId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

    let liveIds = [...present];

    record(sessionId, {
      undo: async () => {
        for (const id of liveIds) await _deleteNode(sessionId, id);
      },
      redo: async () => {
        const oldToNew = new Map<string, string>();
        const remade: string[] = [];
        for (let i = 0; i < nodeSpecs.length; i += 1) {
          const newId = await _addNode(sessionId, nodeSpecs[i]);
          if (!newId) continue;
          oldToNew.set(present[i], newId);
          remade.push(newId);
        }
        for (const e of edgeSpecs) {
          const s = oldToNew.get(e.sourceId) ?? e.sourceId;
          const t = oldToNew.get(e.targetId) ?? e.targetId;
          if (nodeById(sessionId, s) && nodeById(sessionId, t)) {
            await _addEdge(sessionId, s, t, e.sourceHandle, e.targetHandle).catch((): null => null);
          }
        }
        liveIds = remade;
      },
    });
  };

  attempt(1);
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

/**
 * "Animate" an image node: drop a video node to its right, pre-wired to the
 * image node's `start_frame` handle. Same structure the drop-a-wire menu
 * produces, as one undo entry.
 */
export async function animateFromImage(sessionId: string, imageNodeId: string): Promise<string | null> {
  const src = nodeById(sessionId, imageNodeId);
  if (!src || src.type !== 'image') return null;
  return addNodeAndConnect(
    sessionId,
    {
      type: 'video',
      x: src.x + src.w + 56,
      y: src.y,
      title: src.title ? `${src.title} · 运镜` : '视频生成',
      params: { prompt: '', duration: '5s', ratio: '16:9', cameraMotion: 'none' },
    },
    imageNodeId,
    null,
    'start_frame',
  );
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

/** Member ids of any container node (group or section). */
export function containerMemberIds(sessionId: string, containerId: string): string[] {
  const container = nodeById(sessionId, containerId);
  if (!container) return [];
  if (container.type === 'group') {
    return ((container.params as CanvasGroupParams).memberIds ?? []).filter((id) =>
      nodeById(sessionId, id),
    );
  }
  if (container.type === 'section') {
    const params = container.params as CanvasSectionParams;
    // Explicit memberIds takes strict precedence when defined (preventing accidental boundary suction)
    if (params && Array.isArray(params.memberIds)) {
      return params.memberIds.filter((id) => nodeById(sessionId, id));
    }

    // Physical containment fallback (only for legacy sections where memberIds is completely absent):
    const all = state.nodesBySession[sessionId] ?? [];
    return all
      .filter(
        (n) =>
          n.id !== containerId &&
          n.type !== 'section' &&
          n.type !== 'group' &&
          n.x >= container.x - 20 &&
          n.y >= container.y - 20 &&
          n.x + n.w <= container.x + container.w + 20 &&
          n.y + n.h <= container.y + container.h + 20,
      )
      .map((n) => n.id);
  }
  return [];
}

/** Member ids of a group or section node (delegates to containerMemberIds). */
export function groupMemberIds(sessionId: string, groupId: string): string[] {
  return containerMemberIds(sessionId, groupId);
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

export async function batchUpdateNodeParams(
  sessionId: string,
  nodeIds: string[],
  patch: Record<string, unknown>,
): Promise<void> {
  const befores = new Map<string, CanvasNodeParams | undefined>();
  for (const id of nodeIds) {
    befores.set(id, nodeById(sessionId, id)?.params);
    const curr = (nodeById(sessionId, id)?.params ?? {}) as Record<string, unknown>;
    await _setNode(sessionId, id, { params: { ...curr, ...patch } });
  }
  record(sessionId, {
    undo: async () => {
      for (const id of nodeIds) {
        const before = befores.get(id);
        if (before !== undefined) await _setNode(sessionId, id, { params: before });
      }
    },
    redo: async () => {
      for (const id of nodeIds) {
        const curr = (nodeById(sessionId, id)?.params ?? {}) as Record<string, unknown>;
        await _setNode(sessionId, id, { params: { ...curr, ...patch } });
      }
    },
  });
}

export async function loadStarterFlow(sessionId: string): Promise<void> {
  const sectionId = await _addNode(sessionId, {
    type: 'section',
    x: 60,
    y: 60,
    w: 1100,
    h: 520,
    title: '场景一：雨夜霓虹街头',
    params: {
      color: 'blue',
      description: '电影质感：雨夜街道，霓虹倒影，电影镜头跟踪漫步',
    },
  });

  const imageId = await _addNode(sessionId, {
    type: 'image',
    x: 100,
    y: 130,
    w: 320,
    h: 380,
    title: '雨夜概念图 (首帧)',
    params: {
      prompt: 'Cinematic film still, cyberpunk wet street at night, neon reflections in rain puddles, 35mm photograph, moody lighting, 8k',
      size: '1536x1024',
    },
  });

  const videoId = await _addNode(sessionId, {
    type: 'video',
    x: 480,
    y: 130,
    w: 340,
    h: 420,
    title: '漫步运镜视频',
    params: {
      prompt: 'Slow forward camera tracking shot following character walking in rainy night street, cinematic motion',
      duration: '5s',
      ratio: '16:9',
      cameraMotion: 'zoom_in',
    },
  });

  const frameExtractorId = await _addNode(sessionId, {
    type: 'frameExtractor',
    x: 880,
    y: 220,
    w: 200,
    h: 160,
    title: '提取首尾帧',
    params: { mode: 'end' },
  });

  if (imageId && videoId) {
    await _addEdge(sessionId, imageId, videoId, null, 'start_frame');
  }
  if (videoId && frameExtractorId) {
    await _addEdge(sessionId, videoId, frameExtractorId, null, 'video_in');
  }
  if (sectionId && imageId && videoId && frameExtractorId) {
    await _setNode(sessionId, sectionId, {
      params: {
        color: 'blue',
        description: '电影质感：雨夜街道，霓虹倒影，电影镜头跟踪漫步',
        memberIds: [imageId, videoId, frameExtractorId],
      },
    });
  }
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

  const sourceNode = nodeById(sessionId, sourceId);
  const targetNode = nodeById(sessionId, targetId);

  // Self-healing: if connecting a video node output to an image frame slot (start_frame / end_frame)
  // or connecting video -> video without handles:
  const isVideoToFrameSlot =
    sourceNode?.type === 'video' &&
    (targetHandle === 'start_frame' ||
      targetHandle === 'end_frame' ||
      targetHandle === 'reference' ||
      (targetNode?.type === 'video' && !targetHandle));

  if (isVideoToFrameSlot && targetNode) {
    const preferredMode = targetHandle === 'end_frame' ? 'start' : 'end';
    const midX = Math.round((sourceNode.x + sourceNode.w + targetNode.x) / 2 - 100);
    const midY = Math.round((sourceNode.y + targetNode.y) / 2);
    const actualTargetHandle = targetHandle || 'start_frame';

    const extractorId = await _addNode(sessionId, {
      type: 'frameExtractor',
      x: midX,
      y: midY,
      title: preferredMode === 'end' ? '抽尾帧' : '抽首帧',
      params: { mode: preferredMode },
    });

    if (extractorId) {
      let currentExtractorId = extractorId;
      let currentEdge1Id = await _addEdge(sessionId, sourceId, extractorId, sourceHandle, 'video_in');
      let currentEdge2Id = await _addEdge(sessionId, extractorId, targetId, 'frame_out', actualTargetHandle);

      record(sessionId, {
        undo: async () => {
          if (currentEdge2Id) await _deleteEdge(sessionId, currentEdge2Id);
          if (currentEdge1Id) await _deleteEdge(sessionId, currentEdge1Id);
          await _deleteNode(sessionId, currentExtractorId);
        },
        redo: async () => {
          const recreated = await _addNode(sessionId, {
            type: 'frameExtractor',
            x: midX,
            y: midY,
            title: preferredMode === 'end' ? '抽尾帧' : '抽首帧',
            params: { mode: preferredMode },
          });
          if (recreated) {
            currentExtractorId = recreated;
            currentEdge1Id =
              (await _addEdge(sessionId, sourceId, recreated, sourceHandle, 'video_in').catch((): null => null)) ??
              undefined;
            currentEdge2Id =
              (await _addEdge(sessionId, recreated, targetId, 'frame_out', actualTargetHandle).catch(
                (): null => null,
              )) ?? undefined;
          }
        },
      });

      // If upstream video already has asset, trigger extraction automatically!
      if (sourceNode.output?.assets?.[0]) {
        void extractFrameForNode(sessionId, extractorId).catch((): void => undefined);
      }
      return;
    }
  }

  const edgeId = await _addEdge(sessionId, sourceId, targetId, sourceHandle, targetHandle);
  if (!edgeId) return;

  // Mention sync: if connecting into an image/video prompt node via reference/image,
  // ensure the prompt includes the mention token so graph and prompt remain in sync!
  if (
    targetNode &&
    (targetNode.type === 'image' || targetNode.type === 'video') &&
    (targetHandle === 'reference' || targetHandle === 'image' || !targetHandle) &&
    sourceNode &&
    (sourceNode.type === 'image' || sourceNode.type === 'anchor' || sourceNode.type === 'video')
  ) {
    const p = (targetNode.params as { prompt?: string }) ?? {};
    const currPrompt = p.prompt ?? '';
    const mentionToken = `@[${sourceNode.title || '节点'}](canvas:${sourceNode.id})`;
    if (!currPrompt.includes(sourceNode.id)) {
      const nextPrompt = currPrompt.trim() ? `${currPrompt} ${mentionToken}` : mentionToken;
      void updateNodeParams(sessionId, targetId, { ...p, prompt: nextPrompt });
    }
  }

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
      await _addEdge(sessionId, edge.sourceId, edge.targetId, edge.sourceHandle, edge.targetHandle).catch((): null => null);
    },
    redo: async () => {
      const again = (state.edgesBySession[sessionId] ?? []).find(
        (e) => e.sourceId === edge.sourceId && e.targetId === edge.targetId,
      );
      if (again) await _deleteEdge(sessionId, again.id);
    },
  });
}

/**
 * Split an existing edge by inserting a compact Reroute knot at `at`.
 * The original edge (A -> B) is replaced with (A -> Reroute) and (Reroute -> B).
 * Supported with full undo/redo.
 */
export async function insertRerouteNode(
  sessionId: string,
  edgeId: string,
  at: { x: number; y: number },
): Promise<string | null> {
  const edge = (state.edgesBySession[sessionId] ?? []).find((e) => e.id === edgeId);
  if (!edge) return null;

  const originalSourceId = edge.sourceId;
  const originalTargetId = edge.targetId;
  const originalSourceHandle = edge.sourceHandle;
  const originalTargetHandle = edge.targetHandle;

  let rerouteId = await _addNode(sessionId, {
    type: 'reroute',
    x: Math.round(at.x - 10),
    y: Math.round(at.y - 10),
    w: 20,
    h: 20,
    title: '',
  });
  if (!rerouteId) return null;

  await _deleteEdge(sessionId, edgeId);
  let edge1Id = await _addEdge(sessionId, originalSourceId, rerouteId, originalSourceHandle, null);
  let edge2Id = await _addEdge(sessionId, rerouteId, originalTargetId, null, originalTargetHandle);

  record(sessionId, {
    undo: async () => {
      if (edge1Id) await _deleteEdge(sessionId, edge1Id).catch((): void => undefined);
      if (edge2Id) await _deleteEdge(sessionId, edge2Id).catch((): void => undefined);
      if (rerouteId) await _deleteNode(sessionId, rerouteId).catch((): void => undefined);
      await _addEdge(sessionId, originalSourceId, originalTargetId, originalSourceHandle, originalTargetHandle).catch((): null => null);
    },
    redo: async () => {
      rerouteId = await _addNode(sessionId, {
        type: 'reroute',
        x: Math.round(at.x - 10),
        y: Math.round(at.y - 10),
        w: 20,
        h: 20,
        title: '',
      });
      if (!rerouteId) return;
      const oldEdge = (state.edgesBySession[sessionId] ?? []).find(
        (e) => e.sourceId === originalSourceId && e.targetId === originalTargetId,
      );
      if (oldEdge) await _deleteEdge(sessionId, oldEdge.id).catch((): void => undefined);
      edge1Id = await _addEdge(sessionId, originalSourceId, rerouteId, originalSourceHandle, null);
      edge2Id = await _addEdge(sessionId, rerouteId, originalTargetId, null, originalTargetHandle);
    },
  });

  return rerouteId;
}

export function isMoodboard(sessionId: string): boolean {
  return state.moodboardBySession[sessionId] ?? false;
}

export function toggleMoodboard(sessionId: string): void {
  const current = isMoodboard(sessionId);
  setState({
    moodboardBySession: {
      ...state.moodboardBySession,
      [sessionId]: !current,
    },
  });
}

export function setMoodboard(sessionId: string, active: boolean): void {
  setState({
    moodboardBySession: {
      ...state.moodboardBySession,
      [sessionId]: active,
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

const SECTION_PADDING = 36;
const SECTION_HEADER = 60;

function sectionBox(members: CanvasNode[]): { x: number; y: number; w: number; h: number } {
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
    x: Math.round(minX - SECTION_PADDING),
    y: Math.round(minY - SECTION_HEADER),
    w: Math.round(maxX - minX + SECTION_PADDING * 2),
    h: Math.round(maxY - minY + SECTION_HEADER + SECTION_PADDING),
  };
}

export async function createSection(
  sessionId: string,
  memberIds: string[],
  initialTitle?: string,
): Promise<string | null> {
  const nodes = (state.nodesBySession[sessionId] ?? []).filter(
    (n) => memberIds.includes(n.id) && n.type !== 'section',
  );
  if (nodes.length === 0) return null;

  const count = (state.nodesBySession[sessionId] ?? []).filter((n) => n.type === 'section').length + 1;
  const spec = {
    type: 'section' as const,
    ...sectionBox(nodes),
    title: initialTitle || `场景分区 ${count}`,
    params: {
      color: 'blue' as const,
      memberIds: nodes.map((n) => n.id),
      description: '',
    },
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

export async function runSection(sessionId: string, sectionId: string): Promise<void> {
  const memberIds = containerMemberIds(sessionId, sectionId);
  for (const id of memberIds) {
    const node = nodeById(sessionId, id);
    if (node && (node.type === 'image' || node.type === 'video' || node.type === 'agent')) {
      void runNode(sessionId, node.id);
    }
  }
}

export async function collapseToSubgraph(
  sessionId: string,
  memberIds: string[],
  title?: string,
): Promise<string | null> {
  const allNodes = state.nodesBySession[sessionId] ?? [];
  const allEdges = state.edgesBySession[sessionId] ?? [];

  const targetNodes = allNodes.filter((n) => memberIds.includes(n.id) && n.type !== 'subgraph');
  if (targetNodes.length < 2) return null;

  const targetIdSet = new Set(targetNodes.map((n) => n.id));
  const innerEdges = allEdges.filter(
    (e) => targetIdSet.has(e.sourceId) && targetIdSet.has(e.targetId),
  );
  const inboundEdges = allEdges.filter(
    (e) => !targetIdSet.has(e.sourceId) && targetIdSet.has(e.targetId),
  );
  const outboundEdges = allEdges.filter(
    (e) => targetIdSet.has(e.sourceId) && !targetIdSet.has(e.targetId),
  );

  const avgX = Math.round(targetNodes.reduce((sum, n) => sum + n.x, 0) / targetNodes.length);
  const avgY = Math.round(targetNodes.reduce((sum, n) => sum + n.y, 0) / targetNodes.length);

  const innerSnapshot = {
    nodes: targetNodes,
    edges: innerEdges,
  };

  const subgraphCount = allNodes.filter((n) => n.type === 'subgraph').length + 1;
  const subgraphSpec = {
    type: 'subgraph' as const,
    x: avgX,
    y: avgY,
    w: 280,
    h: 190,
    title: title || `复合子图 ${subgraphCount}`,
    params: {
      collapsed: true,
      innerNodeIds: targetNodes.map((n) => n.id),
      innerSnapshot,
      description: `包含 ${targetNodes.length} 个节点的模块`,
    },
  };

  let currentSubgraphId = await _addNode(sessionId, subgraphSpec);
  if (!currentSubgraphId) return null;

  for (const inEdge of inboundEdges) {
    await _addEdge(sessionId, inEdge.sourceId, currentSubgraphId, inEdge.sourceHandle, 'input');
  }
  for (const outEdge of outboundEdges) {
    await _addEdge(sessionId, currentSubgraphId, outEdge.targetId, 'output', outEdge.targetHandle);
  }

  for (const n of targetNodes) {
    await _deleteNode(sessionId, n.id);
  }

  let currentInnerNodeIds: string[] = [];

  record(sessionId, {
    undo: async () => {
      if (currentSubgraphId) await _deleteNode(sessionId, currentSubgraphId);
      const idMap = new Map<string, string>();
      currentInnerNodeIds = [];
      for (const n of innerSnapshot.nodes) {
        const newId = await _addNode(sessionId, {
          type: n.type,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          title: n.title,
          params: n.params,
        });
        if (newId) {
          idMap.set(n.id, newId);
          currentInnerNodeIds.push(newId);
        }
      }
      for (const e of innerSnapshot.edges) {
        const src = idMap.get(e.sourceId) || e.sourceId;
        const tgt = idMap.get(e.targetId) || e.targetId;
        await _addEdge(sessionId, src, tgt, e.sourceHandle, e.targetHandle);
      }
      for (const inEdge of inboundEdges) {
        const tgt = idMap.get(inEdge.targetId) || inEdge.targetId;
        await _addEdge(sessionId, inEdge.sourceId, tgt, inEdge.sourceHandle, inEdge.targetHandle);
      }
      for (const outEdge of outboundEdges) {
        const src = idMap.get(outEdge.sourceId) || outEdge.sourceId;
        await _addEdge(sessionId, src, outEdge.targetId, outEdge.sourceHandle, outEdge.targetHandle);
      }
    },
    redo: async () => {
      for (const id of currentInnerNodeIds) {
        await _deleteNode(sessionId, id);
      }
      const newSubgraphId = await _addNode(sessionId, subgraphSpec);
      if (newSubgraphId) {
        currentSubgraphId = newSubgraphId;
        for (const inEdge of inboundEdges) {
          await _addEdge(sessionId, inEdge.sourceId, newSubgraphId, inEdge.sourceHandle, 'input');
        }
        for (const outEdge of outboundEdges) {
          await _addEdge(sessionId, newSubgraphId, outEdge.targetId, 'output', outEdge.targetHandle);
        }
      }
    },
  });

  return currentSubgraphId;
}

export async function unpackSubgraph(sessionId: string, subgraphId: string): Promise<string[]> {
  const subgraph = nodeById(sessionId, subgraphId);
  if (!subgraph || subgraph.type !== 'subgraph') return [];
  const params = subgraph.params as CanvasSubgraphParams;
  const snapshot = params?.innerSnapshot;
  if (!snapshot || !snapshot.nodes || snapshot.nodes.length === 0) {
    await _deleteNode(sessionId, subgraphId);
    return [];
  }

  const allEdges = state.edgesBySession[sessionId] ?? [];
  const inboundToSubgraph = allEdges.filter((e) => e.targetId === subgraphId);
  const outboundFromSubgraph = allEdges.filter((e) => e.sourceId === subgraphId);

  const subgraphSpec = {
    type: subgraph.type,
    x: subgraph.x,
    y: subgraph.y,
    w: subgraph.w,
    h: subgraph.h,
    title: subgraph.title,
    params: subgraph.params,
  };

  await _deleteNode(sessionId, subgraphId);

  const idMap = new Map<string, string>();
  let unpackedNodeIds: string[] = [];

  for (const n of snapshot.nodes) {
    const newId = await _addNode(sessionId, {
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      title: n.title,
      params: n.params,
    });
    if (newId) {
      idMap.set(n.id, newId);
      unpackedNodeIds.push(newId);
    }
  }

  for (const e of snapshot.edges) {
    const src = idMap.get(e.sourceId) || e.sourceId;
    const tgt = idMap.get(e.targetId) || e.targetId;
    await _addEdge(sessionId, src, tgt, e.sourceHandle, e.targetHandle);
  }

  const firstTarget = idMap.get(snapshot.nodes[0]?.id) || snapshot.nodes[0]?.id;
  if (firstTarget) {
    for (const inEdge of inboundToSubgraph) {
      await _addEdge(sessionId, inEdge.sourceId, firstTarget, inEdge.sourceHandle, 'input');
    }
  }
  const lastSource =
    idMap.get(snapshot.nodes[snapshot.nodes.length - 1]?.id) ||
    snapshot.nodes[snapshot.nodes.length - 1]?.id;
  if (lastSource) {
    for (const outEdge of outboundFromSubgraph) {
      await _addEdge(sessionId, lastSource, outEdge.targetId, 'output', outEdge.targetHandle);
    }
  }

  let currentSubgraphId: string | null = null;

  record(sessionId, {
    undo: async () => {
      for (const id of unpackedNodeIds) {
        await _deleteNode(sessionId, id);
      }
      currentSubgraphId = await _addNode(sessionId, subgraphSpec);
      if (currentSubgraphId) {
        for (const inEdge of inboundToSubgraph) {
          await _addEdge(sessionId, inEdge.sourceId, currentSubgraphId, inEdge.sourceHandle, inEdge.targetHandle);
        }
        for (const outEdge of outboundFromSubgraph) {
          await _addEdge(sessionId, currentSubgraphId, outEdge.targetId, outEdge.sourceHandle, outEdge.targetHandle);
        }
      }
    },
    redo: async () => {
      if (currentSubgraphId) {
        await _deleteNode(sessionId, currentSubgraphId);
      }
      const redoIdMap = new Map<string, string>();
      unpackedNodeIds = [];
      for (const n of snapshot.nodes) {
        const newId = await _addNode(sessionId, {
          type: n.type,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          title: n.title,
          params: n.params,
        });
        if (newId) {
          redoIdMap.set(n.id, newId);
          unpackedNodeIds.push(newId);
        }
      }
      for (const e of snapshot.edges) {
        const src = redoIdMap.get(e.sourceId) || e.sourceId;
        const tgt = redoIdMap.get(e.targetId) || e.targetId;
        await _addEdge(sessionId, src, tgt, e.sourceHandle, e.targetHandle);
      }
      const redoFirstTarget = redoIdMap.get(snapshot.nodes[0]?.id) || snapshot.nodes[0]?.id;
      if (redoFirstTarget) {
        for (const inEdge of inboundToSubgraph) {
          await _addEdge(sessionId, inEdge.sourceId, redoFirstTarget, inEdge.sourceHandle, 'input');
        }
      }
      const redoLastSource =
        redoIdMap.get(snapshot.nodes[snapshot.nodes.length - 1]?.id) ||
        snapshot.nodes[snapshot.nodes.length - 1]?.id;
      if (redoLastSource) {
        for (const outEdge of outboundFromSubgraph) {
          await _addEdge(sessionId, redoLastSource, outEdge.targetId, 'output', outEdge.targetHandle);
        }
      }
    },
  });

  return unpackedNodeIds;
}

export async function runSubgraph(sessionId: string, subgraphId: string): Promise<void> {
  const subgraph = nodeById(sessionId, subgraphId);
  if (!subgraph || subgraph.type !== 'subgraph') return;
  const params = subgraph.params as CanvasSubgraphParams;
  const snapshot = params?.innerSnapshot;

  if (snapshot?.nodes && snapshot.nodes.length > 0) {
    const unpackedIds = await unpackSubgraph(sessionId, subgraphId);
    if (unpackedIds.length > 0) {
      await runGraph(sessionId, undefined, unpackedIds);
    }
    return;
  }

  if (params?.innerNodeIds && params.innerNodeIds.length > 0) {
    await runGraph(sessionId, undefined, params.innerNodeIds);
  }
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

/** Drop an image onto the canvas as a reference `anchor` pin (character by default). */
export async function addAnchorFromFile(
  sessionId: string,
  file: File,
  at: { x: number; y: number },
): Promise<string | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const node = await api.importCanvasImage(id, {
    name: file.name || 'anchor.png',
    dataBase64: btoa(binary),
    x: at.x,
    y: at.y,
    type: 'anchor',
    params: { role: 'character', strength: 'mid' },
  });
  applyEvent(sessionId, { type: 'node_added', node });
  record(sessionId, {
    undo: () => _deleteNode(sessionId, node.id),
    redo: () => Promise.resolve(),
  });
  return node.id;
}

/**
 * Wire a reference anchor into every image/video node in `targetIds` (skipping
 * ones already connected), as one history entry. Returns how many edges landed.
 */
export async function attachAnchor(
  sessionId: string,
  anchorId: string,
  targetIds: string[],
): Promise<number> {
  const nodes = state.nodesBySession[sessionId] ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = state.edgesBySession[sessionId] ?? [];
  const REF_SLOT_MAX = 3;
  const refSlotCount = (tid: string): number =>
    (state.edgesBySession[sessionId] ?? []).filter(
      (e) => e.targetId === tid && (e.targetHandle ?? '').startsWith('ref_'),
    ).length;
  const targets = targetIds.filter((tid) => {
    const t = byId.get(tid);
    if (!t || (t.type !== 'image' && t.type !== 'video')) return false;
    if (edges.some((e) => e.sourceId === anchorId && e.targetId === tid)) return false;
    return refSlotCount(tid) < REF_SLOT_MAX;
  });
  if (targets.length === 0) return 0;

  const connect = async (): Promise<string[]> => {
    const made: string[] = [];
    for (const tid of targets) {
      const slot = Math.min(REF_SLOT_MAX, refSlotCount(tid) + 1);
      const eid = await _addEdge(sessionId, anchorId, tid, null, `ref_${slot}`);
      if (eid) made.push(eid);
    }
    return made;
  };

  let edgeIds = await connect();
  if (edgeIds.length === 0) return 0;
  record(sessionId, {
    undo: async () => {
      for (const eid of edgeIds) await _deleteEdge(sessionId, eid);
    },
    redo: async () => {
      edgeIds = await connect();
    },
  });
  return edgeIds.length;
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

export async function extractFrameForNode(sessionId: string, frameExtractorNodeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const targetNode = nodeById(sessionId, frameExtractorNodeId);
  if (!targetNode || targetNode.type !== 'frameExtractor') return;

  const edges = edgesForSession(sessionId);
  const inEdge = edges.find((e) => e.targetId === frameExtractorNodeId);
  if (!inEdge) throw new Error('未连接上游视频源');

  const sourceNode = nodeById(sessionId, inEdge.sourceId);
  if (!sourceNode || sourceNode.type !== 'video') throw new Error('上游节点不是视频节点');

  const assets = sourceNode.output?.assets ?? [];
  const rel = assets[0];
  if (!rel) throw new Error('上游视频尚未生成产物');

  const params = (targetNode.params as CanvasFrameExtractorParams) || { mode: 'end' };
  const mode = params.mode === 'start' ? 'start' : 'end';
  const customTime = params.timestampSec ?? 0;

  const httpUrl = await api.canvasAssetUrl(rel);
  const blob = await grabVideoFrameBlob(httpUrl, mode, customTime);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

  const updatedNode = await api.setCanvasNodeAsset(id, frameExtractorNodeId, {
    name: `frame-${mode}.png`,
    dataBase64: btoa(binary),
  });
  applyEvent(sessionId, { type: 'node_updated', node: updatedNode });
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

const pendingSelection = new Map<string, string[]>();

export function setSelection(sessionId: string, ids: string[]): void {
  const id = canvasId(sessionId);
  if (!id) return;
  pendingSelection.set(sessionId, ids);
  const prev = selectionTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  selectionTimers.set(
    sessionId,
    setTimeout(() => {
      selectionTimers.delete(sessionId);
      pendingSelection.delete(sessionId);
      void api.setCanvasSelection(id, ids).catch((): void => undefined);
    }, 300),
  );
}

/** Immediately synchronizes pending selection to the backend, preventing debounce race conditions. */
export async function flushSelection(sessionId: string): Promise<void> {
  const prev = selectionTimers.get(sessionId);
  if (prev) {
    clearTimeout(prev);
    selectionTimers.delete(sessionId);
  }
  const pending = pendingSelection.get(sessionId);
  const id = canvasId(sessionId);
  if (id && pending) {
    pendingSelection.delete(sessionId);
    await api.setCanvasSelection(id, pending).catch((): void => undefined);
  }
}

// --- Agent Proposal Diff State (P1-1) ---

export function setProposals(sessionId: string, nodeIds: string[]): void {
  setState({
    proposalsBySession: {
      ...state.proposalsBySession,
      [sessionId]: nodeIds,
    },
  });
}

export function addProposals(sessionId: string, nodeIds: string[]): void {
  const existing = state.proposalsBySession[sessionId] ?? [];
  const merged = Array.from(new Set([...existing, ...nodeIds]));
  setProposals(sessionId, merged);
}

export function isProposal(sessionId: string, nodeId: string): boolean {
  return state.proposalsBySession[sessionId]?.includes(nodeId) ?? false;
}

export async function acceptProposals(sessionId: string): Promise<void> {
  const currentProposals = state.proposalsBySession[sessionId] ?? [];
  if (currentProposals.length === 0) return;

  setProposals(sessionId, []);

  // Safe undo: restoring proposals puts them back in proposal review state, never deletes data
  record(sessionId, {
    undo: () => {
      setProposals(sessionId, currentProposals);
      return Promise.resolve();
    },
    redo: () => {
      setProposals(sessionId, []);
      return Promise.resolve();
    },
  });
}

export async function rejectProposals(sessionId: string): Promise<void> {
  const currentProposals = state.proposalsBySession[sessionId] ?? [];
  if (currentProposals.length === 0) return;

  const allNodes = state.nodesBySession[sessionId] ?? [];
  const allEdges = state.edgesBySession[sessionId] ?? [];

  const nodesToDelete = allNodes.filter((n) => currentProposals.includes(n.id));
  const edgesToDelete = allEdges.filter(
    (e) => currentProposals.includes(e.sourceId) || currentProposals.includes(e.targetId),
  );

  setProposals(sessionId, []);

  for (const e of edgesToDelete) {
    await _deleteEdge(sessionId, e.id);
  }
  for (const n of nodesToDelete) {
    await _deleteNode(sessionId, n.id);
  }

  let liveDeletedIds = currentProposals;

  record(sessionId, {
    undo: async () => {
      const idMap = new Map<string, string>();
      const restoredIds: string[] = [];
      for (const n of nodesToDelete) {
        const newId = await _addNode(sessionId, {
          type: n.type,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          title: n.title,
          params: n.params,
        });
        if (newId) {
          idMap.set(n.id, newId);
          restoredIds.push(newId);
        }
      }
      for (const e of edgesToDelete) {
        const src = idMap.get(e.sourceId) || e.sourceId;
        const tgt = idMap.get(e.targetId) || e.targetId;
        await _addEdge(sessionId, src, tgt, e.sourceHandle, e.targetHandle);
      }
      liveDeletedIds = restoredIds;
      setProposals(sessionId, restoredIds);
    },
    redo: async () => {
      setProposals(sessionId, []);
      for (const id of liveDeletedIds) {
        await _deleteNode(sessionId, id);
      }
    },
  });
}


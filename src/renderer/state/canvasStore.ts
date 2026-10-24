import * as api from '../api';
import { CanvasHistory, type HistoryEntry, type HistoryFlags } from './canvasHistory';
import { CanvasEditCommands } from './canvasEditCommands';
import { restoreNodeEdit, type CanvasEdit, type CanvasNodeSpec, type CanvasEditUpload } from '../../shared/canvasEdits';
import { nanoid } from 'nanoid';
import * as settingsStore from './settingsStore';
import {
  activeSessionId as tabStoreActiveSessionId,
  subscribe as subscribeTabs,
} from './tabStore';
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
  CanvasNodeOutput,
  CanvasImageParams,
} from '../../shared/canvas';
import { defaultNodeBox } from '../../shared/canvas';
import {
  type ImageEditSpec,
  EDIT_META,
  isLocalEdit,
  editNodeTitle,
} from '../../shared/canvasImageEdit';
import { blobToBase64 } from '../lib/blobToBase64';
import { gridArrange } from '../../shared/arrangeNodes';
import { variantGrid } from '../../shared/variantLayout';
import type { AgentTrailEntry } from '../../shared/agentTrail';
import { grabVideoFrameBlob, type FramePick } from '../lib/videoFrame';
import { notifyJobDone, primeNotifications } from '../lib/notify';
import { toast } from '../lib/toast';
import type { CanvasEvent } from '../../shared/canvasStream';
import type { CanvasDocumentChange } from '../../shared/canvasSync';
import { inspectCanvasSyncMessage, projectCanvasChanges, type CanvasSyncCursor } from './canvasSync';
import { CanvasLocalEdits, type CanvasEditablePatch } from './canvasLocalEdits';
import {
  isStructuralTargetHandle,
  mentionPromptKey,
  planMentionWire,
  shouldSyncMentionOnEdge,
} from '../../shared/canvasMentionWire';
import { parseMentionTokens, serializeMention, stripMentionToken } from '../../shared/resolveMentions';

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
  spotlightBySession: Record<string, { ids: string[]; at: number; source?: 'automatic' | 'user' } | undefined>;
  /** Recent agent canvas writes (newest last), derived from chat tool events. */
  trailBySession: Record<string, AgentTrailEntry[]>;
  historyBySession: Record<string, HistoryFlags>;
  /** When true, canvas nodes hide form widgets and show pure media. */
  moodboardBySession: Record<string, boolean>;
  /** Node(s) currently in Agent proposal diff state (rendered with glowing dashed border). */
  proposalsBySession: Record<string, string[]>;
  /** Latest director phase note per session (e.g. "铺设分镜节点") — auto-clears. */
  phaseBySession: Record<string, { label: string; step?: number; total?: number; at: number } | undefined>;
  /** Selected node IDs per session on the canvas. */
  selectedNodeIdsBySession: Record<string, string[]>;
  /** Node whose prompt composer currently owns @ pick (Ctrl+click). Chat composer never sets this. */
  mentionComposerBySession: Record<string, string | undefined>;
  /** Composer node id while the user is multi-picking canvas references. */
  pickingCanvasRefsBySession: Record<string, string | undefined>;
}

export const EMPTY_NODES: CanvasNode[] = [];
export const EMPTY_EDGES: CanvasEdge[] = [];
export const EMPTY_PROPOSALS: string[] = [];
export const EMPTY_TRAIL: AgentTrailEntry[] = [];
export const EMPTY_SELECTED_IDS: string[] = [];

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
  phaseBySession: {},
  selectedNodeIdsBySession: {},
  mentionComposerBySession: {},
  pickingCanvasRefsBySession: {},
};

const mentionInsertBySession = new Map<string, (node: CanvasNode) => void>();

const listeners = new Set<() => void>();
const streamAborts = new Map<string, AbortController>();
const syncCursorBySession = new Map<string, CanvasSyncCursor>();
const projectionGeneration = new Map<string, number>();
const localEditsBySession = new Map<string, CanvasLocalEdits>();
const nodeWriteQueues = new Map<string, Promise<void>>();
const selectionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const proposalToastTimers = new Map<string, ReturnType<typeof setTimeout>>();
const phaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingProposalCounts = new Map<string, number>();

/** Burst-coalesce "Agent 更新了 N 个节点" toasts within an 800ms window. */
export function queueAgentNodesToast(sessionId: string, count: number): void {
  const pending = pendingProposalCounts.get(sessionId) ?? 0;
  pendingProposalCounts.set(sessionId, pending + count);
  const prev = proposalToastTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  proposalToastTimers.set(
    sessionId,
    setTimeout(() => {
      const total = pendingProposalCounts.get(sessionId) ?? 0;
      pendingProposalCounts.delete(sessionId);
      proposalToastTimers.delete(sessionId);
      if (total > 0) toast.info(`Agent 更新了 ${total} 个节点`);
    }, 800),
  );
}

const history = new CanvasHistory((sessionId, flags) => {
  setState({ historyBySession: { ...state.historyBySession, [sessionId]: flags } });
}, async (sessionId, error) => {
  toast.error('历史操作失败，已保留重试入口', error instanceof Error ? error.message : String(error));
  try {
    const fence = captureProjectionFence(sessionId);
    const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId);
    const current = captureProjectionFence(sessionId);
    if (current.canvasId === fence.canvasId && current.generation === fence.generation && current.revision === fence.revision)
      ingestSnapshot(sessionId, snap, current.epoch ?? null, false, acknowledgedVersion);
  } catch { /* Existing committed projection remains available while offline. */ }
});

function setState(patch: Partial<CanvasState>): void {
  const documentSessions = new Set([...Object.keys(patch.nodesBySession ?? {}), ...Object.keys(patch.edgesBySession ?? {})]);
  for (const sessionId of documentSessions) {
    if ((patch.nodesBySession && patch.nodesBySession[sessionId] !== state.nodesBySession[sessionId]) ||
      (patch.edgesBySession && patch.edgesBySession[sessionId] !== state.edgesBySession[sessionId])) {
      projectionGeneration.set(sessionId, (projectionGeneration.get(sessionId) ?? 0) + 1);
    }
  }
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

function record(sessionId: string, entry: HistoryEntry): void { history.record(sessionId, entry); }
export function undo(sessionId: string): Promise<boolean> { return history.undo(sessionId); }
export function redo(sessionId: string): Promise<boolean> { return history.redo(sessionId); }
export function rollbackAgentTurn(sessionId: string): Promise<number> { return history.rollbackAgentTurn(sessionId); }

const editCommands = new CanvasEditCommands((sessionId) => {
  const id = canvasId(sessionId);
  if (!id) throw new Error('画布尚未加载');
  return { snapshot: { canvas: { id, sessionId, liveRevision: syncCursorBySession.get(sessionId)?.revision ?? 0,
    createdAt: '', updatedAt: '' }, nodes: state.nodesBySession[sessionId] ?? [], edges: state.edgesBySession[sessionId] ?? [] },
    accept: (snapshot) => {
      if (canvasId(sessionId) === id) ingestSnapshot(sessionId, snapshot, syncCursorBySession.get(sessionId)?.epoch ?? null);
    } };
}, (...args) => api.editCanvas(...args), record);

function edgeEdit(sourceId: string, targetId: string, sourceHandle?: string | null, targetHandle?: string | null): CanvasEdit {
  return { kind: 'add_edge', edge: { id: nanoid(), sourceId, targetId, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null } };
}

function setNodes(sessionId: string, nodes: CanvasNode[]): void {
  setState({ nodesBySession: { ...state.nodesBySession, [sessionId]: nodes } });
}

function setEdges(sessionId: string, edges: CanvasEdge[]): void {
  setState({ edgesBySession: { ...state.edgesBySession, [sessionId]: edges } });
}

function localEdits(sessionId: string): CanvasLocalEdits {
  let edits = localEditsBySession.get(sessionId);
  if (!edits) { edits = new CanvasLocalEdits(); localEditsBySession.set(sessionId, edits); }
  return edits;
}

async function readCanvasSnapshot(sessionId: string, signal?: AbortSignal) {
  const acknowledgedVersion = localEdits(sessionId).acknowledgedVersion;
  return { snap: await api.getCanvas(sessionId, signal), acknowledgedVersion };
}

function restoreLiveEdits(sessionId: string): void {
  const restored = localEditsBySession.get(sessionId)?.discardAllLive();
  if (!restored?.size) return;
  setNodes(sessionId, (state.nodesBySession[sessionId] ?? EMPTY_NODES).map((node) => restored.get(node.id) ?? node));
}

function confirmLocalAcknowledgements(sessionId: string, acknowledgedVersion: number): void {
  const restored = localEdits(sessionId).confirmAcknowledgements(acknowledgedVersion);
  if (restored.size) setNodes(sessionId, (state.nodesBySession[sessionId] ?? EMPTY_NODES).map((node) => restored.get(node.id) ?? node));
}

function ingestSnapshot(sessionId: string, snap: CanvasSnapshot, epoch: string | null = null, resetActivity = false, acknowledgedVersion = 0): void {
  if (canvasId(sessionId) && canvasId(sessionId) !== snap.canvas.id) history.clear(sessionId);
  const cursor = syncCursorBySession.get(sessionId);
  if (!resetActivity && cursor?.canvasId === snap.canvas.id && snap.canvas.liveRevision < cursor.revision) {
    confirmLocalAcknowledgements(sessionId, acknowledgedVersion);
    return;
  }
  syncCursorBySession.set(sessionId, { canvasId: snap.canvas.id, revision: snap.canvas.liveRevision, epoch });
  const edits = localEdits(sessionId);
  edits.receiveSnapshot(snap.canvas.id, snap.nodes, acknowledgedVersion);
  if (resetActivity) {
    const timer = phaseTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    phaseTimers.delete(sessionId);
  }
  setState({
    canvasIdBySession: { ...state.canvasIdBySession, [sessionId]: snap.canvas.id },
    nodesBySession: { ...state.nodesBySession, [sessionId]: edits.project(snap.nodes) },
    edgesBySession: { ...state.edgesBySession, [sessionId]: snap.edges },
    loadedBySession: { ...state.loadedBySession, [sessionId]: true },
    ...(resetActivity ? {
      graphRunBySession: { ...state.graphRunBySession, [sessionId]: undefined },
      phaseBySession: { ...state.phaseBySession, [sessionId]: undefined },
    } : {}),
  });
}

function applyDocumentChanges(sessionId: string, changes: CanvasDocumentChange[], mutationId?: string): void {
  const previous = { nodes: state.nodesBySession[sessionId] ?? EMPTY_NODES, edges: state.edgesBySession[sessionId] ?? EMPTY_EDGES };
  const committed = projectCanvasChanges(previous, changes);
  const edits = localEdits(sessionId);
  edits.receiveChanges(changes, mutationId);
  const projectedNodes = edits.project(committed.nodes);
  const document = projectedNodes === committed.nodes ? committed : { ...committed, nodes: projectedNodes };
  if (document !== previous) {
    setState({
      nodesBySession: document.nodes === previous.nodes ? state.nodesBySession : { ...state.nodesBySession, [sessionId]: document.nodes },
      edgesBySession: document.edges === previous.edges ? state.edgesBySession : { ...state.edgesBySession, [sessionId]: document.edges },
    });
  }
  if (!state.graphRunBySession[sessionId]?.running) {
    const completed = new Set(changes.flatMap((change) => change.type === 'node_updated' ? [change.node.id]
      : change.type === 'run_state' || change.type === 'node_output' ? [change.id] : []));
    for (const id of completed) {
      const before = previous.nodes.find((node) => node.id === id);
      const after = document.nodes.find((node) => node.id === id);
      if (before?.runState !== 'running' || !after || (after.runState !== 'done' && after.runState !== 'error')) continue;
      const label = after.title || (after.type === 'video' ? '视频' : after.type === 'image' ? '图片' : '节点');
      notifyJobDone(after.runState === 'done' ? '生成完成' : '生成失败', after.runState === 'done' ? `「${label}」已就绪` : `「${label}」运行失败`);
    }
  }
}

function applyEvent(sessionId: string, event: CanvasEvent): void {
  switch (event.type) {
    case 'node_added':
    case 'node_updated':
    case 'node_output':
    case 'run_state':
    case 'node_deleted':
    case 'edge_added':
    case 'edge_deleted':
      applyDocumentChanges(sessionId, [event]);
      break;
    case 'graph_run': {
      const wasRunning = state.graphRunBySession[sessionId]?.running ?? false;
      if (wasRunning && !event.running) {
        const title = event.outcome === 'cancelled' ? '画布流水线已停止'
          : event.outcome === 'error' ? '画布流水线部分失败' : '画布流水线完成';
        notifyJobDone(title, event.outcome === 'cancelled'
          ? `已处理 ${event.done}/${event.total} 个节点`
          : `成功 ${event.succeeded ?? event.done}，失败 ${event.failed ?? 0}，跳过 ${event.skipped ?? 0}`);
      }
      setState({
        graphRunBySession: {
          ...state.graphRunBySession,
          [sessionId]: event.running ? { running: true, done: event.done, total: event.total } : undefined,
        },
      });
      break;
    }
    case 'proposal_created':
      // Director mode keeps ghost nodes in review (ProposalBar); otherwise
      // auto-accept: nodes land as normal members and a toast replaces the
      // review step.
      if (settingsStore.getSnapshot().settings.directorSessions?.[sessionId]) {
        addProposals(sessionId, event.nodeIds);
      } else {
        queueAgentNodesToast(sessionId, event.nodeIds.length);
      }
      break;
    case 'phase': {
      setState({
        phaseBySession: {
          ...state.phaseBySession,
          [sessionId]: { label: event.label, step: event.step, total: event.total, at: Date.now() },
        },
      });
      const prev = phaseTimers.get(sessionId);
      if (prev) clearTimeout(prev);
      phaseTimers.set(
        sessionId,
        setTimeout(() => {
          phaseTimers.delete(sessionId);
          setState({ phaseBySession: { ...state.phaseBySession, [sessionId]: undefined } });
        }, 10_000),
      );
      break;
    }
    case 'proposal_accepted':
    case 'proposal_rejected':
      setProposals(sessionId, []);
      break;
    case 'heartbeat':
      break;
  }
}

/**
 * Only the foreground session holds a live canvas stream. Every mounted tab
 * used to keep one open — HTTP/1.1 browsers cap same-origin connections at
 * ~6, so a handful of restored tabs starved every other API call (this is why
 * ask cards looked unanswerable: the submit POST never reached the server).
 * Inactive sessions get a one-shot snapshot and resync when re-activated.
 */
const desiredOpen = new Set<string>();
const openSnapshotTokens = new Map<string, symbol>();
const startingStreams = new Map<string, Promise<void>>();
let tabWatchStarted = false;

function ownsStream(sessionId: string, abort: AbortController): boolean {
  return !abort.signal.aborted && streamAborts.get(sessionId) === abort && desiredOpen.has(sessionId) && tabStoreActiveSessionId() === sessionId;
}

function activateStream(sessionId: string): Promise<void> {
  const starting = startingStreams.get(sessionId);
  if (starting) return starting;
  if (streamAborts.has(sessionId) || !desiredOpen.has(sessionId) || tabStoreActiveSessionId() !== sessionId) return Promise.resolve();
  // Own the snapshot request as well as the socket. A tab switch invalidates both.
  const abort = new AbortController();
  streamAborts.set(sessionId, abort);
  const activation = (async () => {
    try {
      const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId, abort.signal);
      if (!ownsStream(sessionId, abort)) return;
      ingestSnapshot(sessionId, snap, null, true, acknowledgedVersion);
      void runStream(sessionId, snap.canvas.id, abort);
    } catch (error) {
      if (!ownsStream(sessionId, abort)) return;
      streamAborts.delete(sessionId);
      throw error;
    }
  })();
  startingStreams.set(sessionId, activation);
  void activation.finally(() => {
    if (startingStreams.get(sessionId) === activation) startingStreams.delete(sessionId);
  }).catch((): void => undefined);
  return activation;
}

function syncStreams(): void {
  const active = tabStoreActiveSessionId();
  for (const sessionId of [...streamAborts.keys()]) {
    if (sessionId !== active) {
      streamAborts.get(sessionId)?.abort();
      streamAborts.delete(sessionId);
      startingStreams.delete(sessionId);
      restoreLiveEdits(sessionId);
    }
  }
  for (const sessionId of desiredOpen) {
    if (sessionId === active) void activateStream(sessionId).catch((): void => undefined);
  }
}

function ensureTabWatch(): void {
  if (tabWatchStarted) return;
  tabWatchStarted = true;
  let last = tabStoreActiveSessionId();
  subscribeTabs(() => {
    const next = tabStoreActiveSessionId();
    if (next === last) return;
    last = next;
    syncStreams();
  });
}

class CanvasResyncRequired extends Error {
  constructor(readonly epoch: string) { super('Canvas document requires a fresh snapshot'); }
}

function waitForReconnect(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function runStream(sessionId: string, canvasId: string, abort: AbortController): Promise<void> {
  let resyncEpoch: string | undefined;
  while (ownsStream(sessionId, abort)) {
    if (resyncEpoch !== undefined) {
      try {
        const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId, abort.signal);
        if (!ownsStream(sessionId, abort)) return;
        ingestSnapshot(sessionId, snap, resyncEpoch, true, acknowledgedVersion);
        canvasId = snap.canvas.id;
        resyncEpoch = undefined;
      } catch {
        await waitForReconnect(abort.signal);
        continue;
      }
    }
    try {
      await api.readCanvasSyncStream(
        canvasId,
        syncCursorBySession.get(sessionId)?.revision ?? 0,
        (message) => {
          if (!ownsStream(sessionId, abort)) return;
          const cursor = syncCursorBySession.get(sessionId);
          if (!cursor) return;
          const decision = inspectCanvasSyncMessage(cursor, message);
          if (decision.kind === 'ignore') return;
          if (decision.kind === 'resync') throw new CanvasResyncRequired(decision.epoch);
          syncCursorBySession.set(sessionId, decision.cursor);
          if (decision.kind === 'commit') applyDocumentChanges(sessionId, decision.commit.changes, decision.commit.mutationId);
          if (decision.kind === 'activity') applyEvent(sessionId, decision.event);
        },
        abort.signal,
      );
    } catch (error) {
      if (error instanceof CanvasResyncRequired) resyncEpoch = error.epoch;
    }
    if (!ownsStream(sessionId, abort)) return;
    if (resyncEpoch === undefined) await waitForReconnect(abort.signal);
  }
}

// Snapshot-only loads share one in-flight fetch per session and never hold a
// socket — use this for read-once consumers (thumbnails, ref chips) that would
// otherwise keep a live stream per mounted tab and exhaust Chromium's
// six-connection HTTP/1.1 pool to the API origin.
const ensureInflight = new Map<string, Promise<void>>();

export async function ensureCanvasLoaded(sessionId: string): Promise<void> {
  if (state.loadedBySession[sessionId] || streamAborts.has(sessionId)) return;
  let inflight = ensureInflight.get(sessionId);
  if (!inflight) {
    const generation = projectionGeneration.get(sessionId) ?? 0;
    inflight = readCanvasSnapshot(sessionId).then(({ snap, acknowledgedVersion }) => {
      if ((projectionGeneration.get(sessionId) ?? 0) === generation) ingestSnapshot(sessionId, snap, null, false, acknowledgedVersion);
    }).finally(() => ensureInflight.delete(sessionId));
    ensureInflight.set(sessionId, inflight);
  }
  await inflight;
}

export async function openCanvas(sessionId: string): Promise<void> {
  desiredOpen.add(sessionId);
  const token = Symbol();
  openSnapshotTokens.set(sessionId, token);
  ensureTabWatch();
  primeNotifications();
  try {
    if (tabStoreActiveSessionId() === sessionId) await activateStream(sessionId);
    else {
      const generation = projectionGeneration.get(sessionId) ?? 0;
      const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId);
      if (desiredOpen.has(sessionId) && openSnapshotTokens.get(sessionId) === token && !streamAborts.has(sessionId) &&
        (projectionGeneration.get(sessionId) ?? 0) === generation) ingestSnapshot(sessionId, snap, null, false, acknowledgedVersion);
    }
  } catch (err) {
    if (openSnapshotTokens.get(sessionId) !== token) return;
    desiredOpen.delete(sessionId);
    throw err;
  }
  syncStreams();
}

export function closeCanvas(sessionId: string): void {
  desiredOpen.delete(sessionId);
  openSnapshotTokens.delete(sessionId);
  streamAborts.get(sessionId)?.abort();
  streamAborts.delete(sessionId);
  startingStreams.delete(sessionId);
  restoreLiveEdits(sessionId);
}

function canvasId(sessionId: string): string | undefined {
  return state.canvasIdBySession[sessionId];
}

function captureProjectionFence(sessionId: string, expectedCanvasId = canvasId(sessionId)) {
  const cursor = syncCursorBySession.get(sessionId);
  return {
    canvasId: expectedCanvasId,
    generation: projectionGeneration.get(sessionId) ?? 0,
    revision: cursor?.revision,
    epoch: cursor?.epoch,
  };
}

/** A delayed HTTP response must not undo a newer stream commit or local edit. */
async function applyResponseEvent(sessionId: string, event: CanvasEvent, fence: ReturnType<typeof captureProjectionFence>): Promise<void> {
  const current = captureProjectionFence(sessionId);
  if (current.canvasId === fence.canvasId && current.generation === fence.generation &&
    current.revision === fence.revision && current.epoch === fence.epoch) {
    applyEvent(sessionId, event);
    return;
  }
  if (streamAborts.has(sessionId) || current.canvasId !== fence.canvasId) return;
  // Inactive canvases have no live commits to fill in a skipped response.
  try {
    const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId);
    if (!streamAborts.has(sessionId) && canvasId(sessionId) === current.canvasId &&
      (projectionGeneration.get(sessionId) ?? 0) === current.generation) ingestSnapshot(sessionId, snap, null, false, acknowledgedVersion);
  } catch { /* The next activation reloads an authoritative snapshot. */ }
}

/** Field ownership separates local edits from full authoritative rows on the live channel. */
async function writeNodePatches(sessionId: string, writes: { nodeId: string; patch: CanvasEditablePatch }[]): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const nodes = state.nodesBySession[sessionId] ?? EMPTY_NODES;
  const edits = localEdits(sessionId);
  const prepared = writes.flatMap((write) => {
    const node = nodes.find((item) => item.id === write.nodeId);
    if (!node) return [];
    const mutationId = nanoid();
    edits.stage(node, write.patch, mutationId);
    return [{ ...write, mutationId }];
  });
  if (prepared.length === 0) return;
  setNodes(sessionId, edits.project(nodes));
  const requestFence = captureProjectionFence(sessionId);
  await Promise.all(prepared.map(({ nodeId, patch, mutationId }) => queueNodeWrite(JSON.stringify([sessionId, id, nodeId]), async () => {
    try {
      const response = await api.patchCanvasNode(id, nodeId, patch, mutationId);
      if (canvasId(sessionId) !== id) return;
      const current = captureProjectionFence(sessionId);
      const acceptResponse = !streamAborts.has(sessionId) && current.generation === requestFence.generation &&
        current.revision === requestFence.revision && current.epoch === requestFence.epoch;
      const acknowledged = edits.acknowledge(nodeId, id, mutationId, response, !acceptResponse);
      if (acknowledged) setNodes(sessionId, (state.nodesBySession[sessionId] ?? EMPTY_NODES).map((node) => node.id === nodeId ? acknowledged : node));
      const abort = streamAborts.get(sessionId);
      if (edits.hasOwner(nodeId, mutationId)) {
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const fence = captureProjectionFence(sessionId);
            const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId, abort?.signal);
            if (canvasId(sessionId) !== id || (abort ? !ownsStream(sessionId, abort) : streamAborts.has(sessionId))) return;
            const after = captureProjectionFence(sessionId);
            if (after.generation === fence.generation || after.revision !== fence.revision) {
              ingestSnapshot(sessionId, snap, syncCursorBySession.get(sessionId)?.epoch ?? null, false, acknowledgedVersion);
              break;
            }
            if ((after.revision ?? 0) >= snap.canvas.liveRevision) {
              confirmLocalAcknowledgements(sessionId, acknowledgedVersion);
              break;
            }
            // A newer local edit changed the projection during this fetch; retry from its fence.
          }
        } catch { /* Durable replay or the next fresh snapshot confirms the accepted edit. */ }
      }
    } catch (error) {
      const restored = edits.fail(nodeId, id, mutationId);
      if (!restored || canvasId(sessionId) !== id) throw error;
      setNodes(sessionId, (state.nodesBySession[sessionId] ?? EMPTY_NODES).map((node) => node.id === nodeId ? restored : node));
      const fence = captureProjectionFence(sessionId);
      try {
        const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId);
        const current = captureProjectionFence(sessionId);
        if (current.canvasId === fence.canvasId && current.generation === fence.generation && current.revision === fence.revision &&
          current.epoch === fence.epoch) ingestSnapshot(sessionId, snap, current.epoch ?? null, false, acknowledgedVersion);
      } catch { /* Latest committed fields were already restored above. */ }
      throw error;
    }
  })));
}

function queueNodeWrite(key: string, write: () => Promise<void>): Promise<void> {
  const previous = nodeWriteQueues.get(key) ?? Promise.resolve();
  const queued = previous.catch((): void => undefined).then(write);
  nodeWriteQueues.set(key, queued);
  void queued.finally(() => {
    if (nodeWriteQueues.get(key) === queued) nodeWriteQueues.delete(key);
  }).catch((): void => undefined);
  return queued;
}

export function nodeById(sessionId: string, nodeId: string): CanvasNode | undefined {
  return (state.nodesBySession[sessionId] ?? []).find((n) => n.id === nodeId);
}

/** Pan (single) or fit (multi) the canvas to these nodes with a brief pulse. */
export function spotlight(sessionId: string, ids: string[], source: 'automatic' | 'user' = 'user'): void {
  const present = ids.filter((id) => nodeById(sessionId, id));
  if (present.length === 0) return;
  setState({
    spotlightBySession: { ...state.spotlightBySession, [sessionId]: { ids: present, at: Date.now(), source } },
  });
}

/** Back-compat thin wrapper — existing callers pass one id. */
export function focusNode(sessionId: string, nodeId: string): void {
  spotlight(sessionId, [nodeId]);
}

export function setMentionComposer(
  sessionId: string,
  nodeId: string,
  insert: (node: CanvasNode) => void,
): void {
  mentionInsertBySession.set(sessionId, insert);
  if (state.mentionComposerBySession[sessionId] === nodeId) return;
  setState({
    mentionComposerBySession: { ...state.mentionComposerBySession, [sessionId]: nodeId },
  });
}

export function clearMentionComposer(sessionId: string, nodeId?: string): void {
  const current = state.mentionComposerBySession[sessionId];
  if (nodeId && current && current !== nodeId) return;
  mentionInsertBySession.delete(sessionId);
  if (!current && !state.pickingCanvasRefsBySession[sessionId]) return;
  setState({
    mentionComposerBySession: { ...state.mentionComposerBySession, [sessionId]: undefined },
    pickingCanvasRefsBySession: { ...state.pickingCanvasRefsBySession, [sessionId]: undefined },
  });
}

export function startPickingCanvasRefs(sessionId: string, composerNodeId: string): void {
  if (state.pickingCanvasRefsBySession[sessionId] === composerNodeId) return;
  setState({
    pickingCanvasRefsBySession: { ...state.pickingCanvasRefsBySession, [sessionId]: composerNodeId },
  });
}

export function stopPickingCanvasRefs(sessionId: string): void {
  if (!state.pickingCanvasRefsBySession[sessionId]) return;
  setState({
    pickingCanvasRefsBySession: { ...state.pickingCanvasRefsBySession, [sessionId]: undefined },
  });
}

export function composerRefIds(node: CanvasNode | undefined): string[] {
  const ids = (node?.params as { refNodeIds?: unknown } | undefined)?.refNodeIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export async function addComposerRef(sessionId: string, composerId: string, sourceId: string): Promise<void> {
  if (composerId === sourceId) return;
  const node = nodeById(sessionId, composerId);
  if (!node) return;
  const ids = composerRefIds(node);
  if (ids.includes(sourceId)) return;
  const latest = nodeById(sessionId, composerId) ?? node;
  const p = (latest.params as Record<string, unknown>) ?? {};
  await updateNodeParams(sessionId, composerId, { ...p, refNodeIds: [...ids, sourceId] });
}

export async function removeComposerRef(sessionId: string, composerId: string, sourceId: string): Promise<void> {
  const node = nodeById(sessionId, composerId);
  if (!node) return;
  const ids = composerRefIds(node);
  if (!ids.includes(sourceId)) return;
  const latest = nodeById(sessionId, composerId) ?? node;
  const p = (latest.params as Record<string, unknown>) ?? {};
  await updateNodeParams(sessionId, composerId, { ...p, refNodeIds: ids.filter((id) => id !== sourceId) });
}

export async function connectMention(sessionId: string, targetId: string, source: CanvasNode,
  opts?: { preserveSelection?: boolean }): Promise<void> {
  const target = nodeById(sessionId, targetId); if (!target) return;
  const ids = [...new Set([...composerRefIds(target), source.id])];
  const wire = planMentionWire(source, target);
  const connection = wire ? planConnection(sessionId, source, target, wire.sourceHandle, wire.targetHandle) : { edits: [] as CanvasEdit[] };
  const paramsEdit = connection.edits.find((edit) => edit.kind === 'update_node' && edit.id === targetId);
  const params = paramsEdit?.kind === 'update_node' ? paramsEdit.patch.params : target.params;
  const edits = connection.edits.filter((edit) => edit !== paramsEdit);
  if (JSON.stringify(composerRefIds(target)) !== JSON.stringify(ids) || paramsEdit)
    edits.push({ kind: 'update_node', id: targetId, patch: { params: { ...params, refNodeIds: ids } } });
  await editCommands.commit(sessionId, edits);
  if (!opts?.preserveSelection) setSelection(sessionId, [targetId]);
  if (connection.extractorId && source.output?.assets?.length) void extractFrameForNode(sessionId, connection.extractorId).catch((error) => toast.error('抽帧失败', String(error)));
}

function mentionRemovalEdits(sessionId: string, targetId: string, sourceId: string): CanvasEdit[] {
  const edges = edgesForSession(sessionId);
  const removals: CanvasEdit[] = edges.filter((edge) => edge.sourceId === sourceId && edge.targetId === targetId && !isStructuralTargetHandle(edge.targetHandle))
    .map((edge) => ({ kind: 'delete_edge', id: edge.id }));
  for (const inbound of edges.filter((edge) => edge.sourceId === sourceId)) {
    const middle = nodeById(sessionId, inbound.targetId);
    if (middle?.type !== 'frameExtractor') continue;
    const outbound = edges.find((edge) => edge.sourceId === middle.id && edge.targetId === targetId);
    if (!outbound) continue;
    const shared = edges.some((edge) => edge.id !== inbound.id && edge.id !== outbound.id && (edge.sourceId === middle.id || edge.targetId === middle.id));
    removals.push(shared ? { kind: 'delete_edge', id: outbound.id } : { kind: 'delete_node', id: middle.id });
  }
  return removals;
}

export async function disconnectMention(sessionId: string, targetId: string, sourceId: string): Promise<void> {
  const target = nodeById(sessionId, targetId); if (!target) return;
  const params = { ...target.params, refNodeIds: composerRefIds(target).filter((id) => id !== sourceId) } as Record<string, unknown>;
  const key = mentionPromptKey(target.type);
  if (key && typeof params[key] === 'string') params[key] = stripMentionToken(params[key] as string, sourceId);
  await editCommands.commit(sessionId, [...mentionRemovalEdits(sessionId, targetId, sourceId), { kind: 'update_node', id: targetId, patch: { params } }]);
}

export async function syncMentionWires(sessionId: string, nodeId: string, livePrompt?: string): Promise<void> {
  const target = nodeById(sessionId, nodeId); if (!target) return;
  const key = mentionPromptKey(target.type); if (!key) return;
  const prompt = livePrompt ?? ((target.params as Record<string, unknown>)[key] as string) ?? '';
  const mentioned = new Set(parseMentionTokens(prompt).flatMap((token) => token.type === 'mention' ? [token.id] : []));
  const all = edgesForSession(sessionId);
  const wired = new Set<string>();
  for (const edge of all) {
    if (edge.targetId !== nodeId || isStructuralTargetHandle(edge.targetHandle)) continue;
    const source = nodeById(sessionId, edge.sourceId);
    const inbound = source?.type === 'frameExtractor' && !mentioned.has(source.id) ? all.find((edge) => edge.targetId === source.id) : undefined;
    wired.add(inbound ? inbound.sourceId : edge.sourceId);
  }
  const edits: CanvasEdit[] = [];
  for (const sourceId of wired) if (!mentioned.has(sourceId)) edits.push(...mentionRemovalEdits(sessionId, nodeId, sourceId));
  for (const sourceId of mentioned) {
    const source = nodeById(sessionId, sourceId);
    const wire = source ? planMentionWire(source, target) : null;
    if (wire) edits.push(...planConnection(sessionId, source, { ...target, params: { ...target.params, [key]: prompt } }, wire.sourceHandle, wire.targetHandle).edits.filter((edit) => edit.kind !== 'update_node' || edit.id !== nodeId));
  }
  const params = { ...target.params, [key]: prompt, refNodeIds: [...mentioned] };
  if (JSON.stringify(params) !== JSON.stringify(target.params)) edits.push({ kind: 'update_node', id: nodeId, patch: { params } });
  const deleted = new Set<string>();
  await editCommands.commit(sessionId, edits.filter((edit) => {
    if (edit.kind !== 'delete_node' && edit.kind !== 'delete_edge') return true;
    const id = `${edit.kind}:${edit.id}`; if (deleted.has(id)) return false; deleted.add(id); return true;
  }));
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

const createRequests = new WeakMap<object, { canvasId: string; nodeId: string; pending?: { id: string; input: Parameters<typeof api.addCanvasNode>[1] } }>();
const deleteRequests = new Map<string, string>();

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
  const fence = captureProjectionFence(sessionId, id);
  let request = createRequests.get(spec);
  if (!request || request.canvasId !== id) { request = { canvasId: id, nodeId: nanoid() }; createRequests.set(spec, request); }
  request.pending ??= { id: nanoid(), input: structuredClone({ ...spec, id: request.nodeId }) };
  let node: CanvasNode;
  try { node = await api.addCanvasNode(id, request.pending.input, request.pending.id); }
  catch (error) {
    const status = (error as { status?: number })?.status;
    if (status >= 400 && status < 500) request.pending = undefined;
    throw error;
  }
  request.pending = undefined;
  await applyResponseEvent(sessionId, { type: 'node_added', node }, fence);
  if (canvasId(sessionId) !== id) throw new Error('画布身份已经变化');
  return node.id;
}

async function _deleteNode(sessionId: string, nodeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) throw new Error('画布尚未加载');
  const fence = captureProjectionFence(sessionId, id);
  const key = JSON.stringify([sessionId, id, nodeId]);
  const operationId = deleteRequests.get(key) ?? nanoid(); deleteRequests.set(key, operationId);
  try { await api.deleteCanvasNode(id, nodeId, operationId); }
  catch (error) {
    const status = (error as { status?: number })?.status;
    if (status >= 400 && status < 500) deleteRequests.delete(key);
    throw error;
  }
  deleteRequests.delete(key);
  localEditsBySession.get(sessionId)?.remove(nodeId);
  await applyResponseEvent(sessionId, { type: 'node_deleted', id: nodeId }, fence);
}

async function _setPosition(sessionId: string, nodeId: string, x: number, y: number): Promise<void> {
  await writeNodePatches(sessionId, [{ nodeId, patch: { x: Math.round(x), y: Math.round(y) } }]);
}

export async function resizeNode(sessionId: string, nodeId: string, w: number, h: number): Promise<void> {
  return _setSize(sessionId, nodeId, w, h);
}

async function _setSize(sessionId: string, nodeId: string, w: number, h: number): Promise<void> {
  await writeNodePatches(sessionId, [{ nodeId, patch: { w: Math.round(w), h: Math.round(h) } }]);
}

async function _setBox(
  sessionId: string,
  nodeId: string,
  box: { w: number; h: number; x?: number; y?: number },
): Promise<void> {
  const patch: CanvasEditablePatch = { w: Math.round(box.w), h: Math.round(box.h) };
  if (box.x !== undefined) patch.x = Math.round(box.x);
  if (box.y !== undefined) patch.y = Math.round(box.y);
  await writeNodePatches(sessionId, [{ nodeId, patch }]);
}

async function _setNode(
  sessionId: string,
  nodeId: string,
  patch: { params?: CanvasNodeParams; title?: string; output?: CanvasNodeOutput },
): Promise<void> {
  await writeNodePatches(sessionId, [{ nodeId, patch }]);
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
  const fence = captureProjectionFence(sessionId, id);
  const edge = await api.addCanvasEdge(id, { sourceId, targetId, sourceHandle, targetHandle });
  await applyResponseEvent(sessionId, { type: 'edge_added', edge }, fence);
  return edge.id;
}

async function _deleteEdge(sessionId: string, edgeId: string): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) throw new Error('画布尚未加载');
  const fence = captureProjectionFence(sessionId, id);
  await api.deleteCanvasEdge(id, edgeId);
  await applyResponseEvent(sessionId, { type: 'edge_deleted', id: edgeId }, fence);
}

// --- public mutations (with history) ---

export async function addNode(
  sessionId: string,
  type: CanvasNodeType,
  at: { x: number; y: number },
  params?: CanvasNodeParams,
): Promise<string | null> {
  const spec = { type, x: at.x, y: at.y, params };
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
  return (await forkSelected(sessionId, [nodeId]))[0] ?? null;
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

  const ids = specs.map(() => nanoid());
  const edits: CanvasEdit[] = specs.flatMap((spec, i) => [
    { kind: 'add_node' as const, id: ids[i], node: spec },
    ...incoming.map((edge) => edgeEdit(edge.sourceId, ids[i], edge.sourceHandle, edge.targetHandle)),
  ]);
  await editCommands.commit(sessionId, edits);
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

  const ids = plans.map(() => nanoid());
  await editCommands.commit(sessionId, plans.flatMap((plan, i) => [
    { kind: 'add_node' as const, id: ids[i], node: plan.spec },
    ...plan.incoming.map((edge) => edgeEdit(edge.sourceId, ids[i], edge.sourceHandle, edge.targetHandle)),
  ]));
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
export function recordAgentBatch(sessionId: string, entry: AgentTrailEntry, agentTurn?: number): void {
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
    const nodes = present.map((id) => nodeById(sessionId, id)).filter((node): node is CanvasNode => Boolean(node));
    const edges = edgesForSession(sessionId).filter((edge) => idSet.has(edge.sourceId) || idSet.has(edge.targetId));
    editCommands.recordExisting(sessionId, present.map((id) => ({ kind: 'delete_node', id })),
      [...nodes.map(restoreNodeEdit), ...edges.map((edge): CanvasEdit => ({ kind: 'add_edge', edge }))], agentTurn);
  };

  attempt(1);
}

export async function addDownstreamAgent(sessionId: string, sourceId: string,
  instruction = '请评估该图片，从画面构图、细节与质感给出点评，并提供优化后的 Prompt 建议。'): Promise<string | null> {
  const source = nodeById(sessionId, sourceId);
  if (!source) return null;
  return addNodeAndConnect(sessionId, { type: 'agent', x: source.x + source.w + 40, y: source.y,
    title: '画面质检', params: { instruction } }, sourceId);
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

const preparedNodeRemovals = new Map<string, () => Promise<void>>();

/** Delete a selection and clean surviving references with one command and one undo. */
export async function removeNodes(sessionId: string, nodeIds: string[]): Promise<void> {
  const ids = [...new Set(nodeIds)].sort();
  if (!ids.length) return;
  const key = JSON.stringify([sessionId, canvasId(sessionId), ids]);
  let apply = preparedNodeRemovals.get(key);
  if (!apply) {
    const nodes = state.nodesBySession[sessionId] ?? EMPTY_NODES;
    const present = new Set(nodes.map((node) => node.id));
    const removed = new Set(ids.filter((id) => present.has(id)));
    if (!removed.size) return;
    const edits: CanvasEdit[] = [];
    for (const node of nodes) {
      if (removed.has(node.id)) continue;
      const params = { ...node.params } as Record<string, unknown>;
      let changed = false;
      const refs = composerRefIds(node);
      const remaining = refs.filter((id) => !removed.has(id));
      if (remaining.length !== refs.length) { params.refNodeIds = remaining; changed = true; }
      const promptKey = mentionPromptKey(node.type);
      const text = promptKey && typeof params[promptKey] === 'string' ? params[promptKey] as string : null;
      if (text !== null && promptKey) {
        let next = text;
        for (const token of parseMentionTokens(text)) {
          if (token.type === 'mention' && removed.has(token.id)) next = stripMentionToken(next, token.id);
        }
        if (next !== text) { params[promptKey] = next; changed = true; }
      }
      if (changed) edits.push({ kind: 'update_node', id: node.id, patch: { params } });
    }
    // Node deletion already cascades incident edges. Explicit edge deletes here
    // would duplicate shared removals when both endpoints are in the selection.
    edits.push(...[...removed].map((id): CanvasEdit => ({ kind: 'delete_node', id })));
    apply = editCommands.prepare(sessionId, edits);
    preparedNodeRemovals.set(key, apply);
  }
  try { await apply(); }
  catch (error) {
    const status = (error as { status?: number })?.status;
    // A definite rejection permits replanning against the latest projection;
    // only an unknown transport outcome retains the frozen plan for replay.
    if (status >= 400 && status < 500) preparedNodeRemovals.delete(key);
    throw error;
  }
  preparedNodeRemovals.delete(key);
  setSelection(sessionId, (state.selectedNodeIdsBySession[sessionId] ?? []).filter((id) => !ids.includes(id)));
}

export async function removeNode(sessionId: string, nodeId: string): Promise<void> {
  await removeNodes(sessionId, [nodeId]);
}

/** Records one history entry for a whole drag gesture. */
export function commitMove(sessionId: string, nodeId: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (from.x === to.x && from.y === to.y) {
    discardNodeLiveGeometry(sessionId, nodeId, ['x', 'y']);
    return;
  }
  void _setPosition(sessionId, nodeId, to.x, to.y).then(() => record(sessionId, {
    undo: () => _setPosition(sessionId, nodeId, from.x, from.y), redo: () => _setPosition(sessionId, nodeId, to.x, to.y),
  })).catch((error) => toast.error('移动失败', String(error)));
}

/** Live position during a drag — no API call, no history (commitMove does both). */
export function moveNodeLive(sessionId: string, nodeId: string, x: number, y: number): void {
  moveNodesGeometryLive(sessionId, new Map([[nodeId, { x, y }]]));
}

/** Batch live positions during drag for high-performance atomic update. */
export function moveNodesBatchLive(sessionId: string, moves: Map<string, { x: number; y: number }>): void {
  moveNodesGeometryLive(sessionId, moves);
}

/** React Flow reports drag and resize frames here; persistence stays at gesture end. */
export function moveNodesGeometryLive(sessionId: string, moves: Map<string, Partial<Pick<CanvasNode, 'x' | 'y' | 'w' | 'h'>>>): void {
  if (moves.size === 0) return;
  const nodes = state.nodesBySession[sessionId] ?? EMPTY_NODES;
  const edits = localEdits(sessionId);
  for (const node of nodes) {
    const patch = moves.get(node.id);
    if (patch) edits.stage(node, patch);
  }
  const projected = edits.project(nodes);
  if (projected !== nodes) setNodes(sessionId, projected);
}

function discardNodeLiveGeometry(sessionId: string, nodeId: string, keys: Array<'x' | 'y' | 'w' | 'h'>): void {
  const restored = localEditsBySession.get(sessionId)?.discardLive(nodeId, keys);
  if (restored) setNodes(sessionId, (state.nodesBySession[sessionId] ?? EMPTY_NODES).map((node) => node.id === nodeId ? restored : node));
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
  for (const move of moves) {
    if (move.from.x === move.to.x && move.from.y === move.to.y) discardNodeLiveGeometry(sessionId, move.id, ['x', 'y']);
  }
  if (real.length === 0) return;
  if (real.length === 1) {
    commitMove(sessionId, real[0].id, real[0].from, real[0].to);
    return;
  }
  const plan = (pick: 'from' | 'to'): CanvasEdit[] => real.map((move) => ({ kind: 'update_node', id: move.id,
    patch: { x: Math.round(move[pick].x), y: Math.round(move[pick].y) } }));
  const forward = plan('to');
  const inverse = plan('from');
  const mutationId = nanoid();
  const edits = localEdits(sessionId);
  const id = canvasId(sessionId);
  const nodes = state.nodesBySession[sessionId] ?? EMPTY_NODES;
  for (const move of real) {
    const node = nodes.find((node) => node.id === move.id);
    if (node) edits.stage(node, { x: Math.round(move.to.x), y: Math.round(move.to.y) }, mutationId);
  }
  setNodes(sessionId, edits.project(nodes));
  void api.editCanvas(id, forward, mutationId).then((snapshot) => {
    if (canvasId(sessionId) !== id) return;
    for (const move of real) {
      const node = snapshot.nodes.find((node) => node.id === move.id);
      if (node) edits.acknowledge(move.id, id, mutationId, node, false);
    }
    ingestSnapshot(sessionId, snapshot, syncCursorBySession.get(sessionId)?.epoch ?? null);
    editCommands.recordExisting(sessionId, inverse, forward);
  }).catch((error) => {
    for (const move of real) {
      const restored = edits.fail(move.id, id, mutationId);
      if (restored && canvasId(sessionId) === id) setNodes(sessionId, (state.nodesBySession[sessionId] ?? []).map((node) => node.id === restored.id ? restored : node));
    }
    toast.error('批量移动失败', String(error));
  });
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
  from: { w: number; h: number; x?: number; y?: number },
  to: { w: number; h: number; x?: number; y?: number },
): void {
  if (
    from.w === to.w &&
    from.h === to.h &&
    (from.x === undefined || from.x === to.x) &&
    (from.y === undefined || from.y === to.y)
  ) {
    discardNodeLiveGeometry(sessionId, nodeId, ['x', 'y', 'w', 'h']);
    return;
  }
  void _setBox(sessionId, nodeId, to).then(() => record(sessionId, {
    undo: () => _setBox(sessionId, nodeId, from), redo: () => _setBox(sessionId, nodeId, to),
  })).catch((error) => toast.error('调整尺寸失败', String(error)));
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

export async function updateNodeOutput(
  sessionId: string,
  nodeId: string,
  output: CanvasNodeOutput,
): Promise<void> {
  await _setNode(sessionId, nodeId, { output });
}

export async function removeNodeAsset(
  sessionId: string,
  nodeId: string,
  assetIndex: number,
): Promise<void> {
  const node = nodeById(sessionId, nodeId);
  if (!node || !node.output?.assets) return;
  const nextAssets = node.output.assets.filter((_, i) => i !== assetIndex);
  const nextResultSet = node.output.resultSet?.filter((_, i) => i !== assetIndex);
  const currentActive = node.output.activeAssetIndex ?? 0;
  let nextActiveIndex = currentActive;
  if (assetIndex < currentActive) {
    nextActiveIndex = currentActive - 1;
  } else if (nextActiveIndex >= nextAssets.length) {
    nextActiveIndex = Math.max(0, nextAssets.length - 1);
  }
  const nextOutput: CanvasNodeOutput = {
    ...node.output,
    assets: nextAssets,
    resultSet: nextResultSet,
    activeAssetIndex: nextActiveIndex,
  };
  await _setNode(sessionId, nodeId, { output: nextOutput });
}

export async function batchUpdateNodeParams(sessionId: string, nodeIds: string[], patch: Record<string, unknown>): Promise<void> {
  const edits = nodeIds.flatMap((id): CanvasEdit[] => {
    const node = nodeById(sessionId, id);
    return node ? [{ kind: 'update_node', id, patch: { params: { ...node.params, ...patch } } }] : [];
  });
  await editCommands.commit(sessionId, edits);
}

export function prepareStarterFlow(sessionId: string, at: { x: number; y: number } = { x: 60, y: 60 }): () => Promise<void> {
  const [section, image, video, extractor] = Array.from({ length: 4 }, () => nanoid());
  return editCommands.prepare(sessionId, [
    { kind: 'add_node', id: section, node: { type: 'section', x: at.x, y: at.y, w: 1100, h: 520, title: '场景一：雨夜霓虹街头',
      params: { color: 'blue', memberIds: [image, video, extractor], description: '电影质感：雨夜街道，霓虹倒影，电影镜头跟踪漫步' } } },
    { kind: 'add_node', id: image, node: { type: 'image', x: at.x + 40, y: at.y + 70, w: 320, h: 380, title: '雨夜概念图 (首帧)',
      params: { prompt: 'Cinematic film still, cyberpunk wet street at night, neon reflections in rain puddles, 35mm photograph, moody lighting, 8k', size: '1536x1024' } } },
    { kind: 'add_node', id: video, node: { type: 'video', x: at.x + 420, y: at.y + 70, w: 340, h: 420, title: '漫步运镜视频',
      params: { prompt: 'Slow forward camera tracking shot following character walking in rainy night street, cinematic motion', duration: '5s', ratio: '16:9', cameraMotion: 'zoom_in' } } },
    { kind: 'add_node', id: extractor, node: { type: 'frameExtractor', x: at.x + 820, y: at.y + 160, w: 200, h: 160, title: '提取首尾帧', params: { mode: 'end' } } },
    edgeEdit(image, video, null, 'start_frame'), edgeEdit(video, extractor, null, 'video_in'),
  ]);
}

export async function loadStarterFlow(sessionId: string): Promise<void> {
  await prepareStarterFlow(sessionId)();
}

/** Throws with a readable message when the server rejects the connection. */
function connectionMentionParams(source: Pick<CanvasNode, 'id' | 'title' | 'type'>, target: Pick<CanvasNode, 'type' | 'params'>,
  targetHandle?: string | null): Record<string, unknown> | undefined {
  if (!shouldSyncMentionOnEdge(targetHandle, source.type)) return;
  const key = mentionPromptKey(target.type);
  if (!key) return;
  const params = target.params as Record<string, unknown>;
  const prompt = typeof params[key] === 'string' ? params[key] as string : '';
  const mentions = parseMentionTokens(prompt).flatMap((token) => token.type === 'mention' ? [token.id] : []);
  const token = serializeMention(source.title || '节点', source.id);
  return { ...params, [key]: mentions.includes(source.id) ? prompt : prompt.trim() ? `${prompt} ${token}` : token,
    refNodeIds: [...new Set([...mentions, source.id])] };
}

function planConnection(sessionId: string, source: CanvasNode, target: CanvasNode, sourceHandle?: string | null,
  targetHandle?: string | null): { edits: CanvasEdit[]; extractorId?: string } {
  const edges = edgesForSession(sessionId);
  if (source.id === target.id || edges.some((edge) => edge.sourceId === source.id && edge.targetId === target.id)) return { edits: [] };
  if (source.type === 'video' && (['start_frame', 'end_frame', 'reference'].includes(targetHandle) || target.type === 'video' && !targetHandle)) {
    if (edges.some((edge) => edge.sourceId === source.id && nodeById(sessionId, edge.targetId)?.type === 'frameExtractor' && edges.some((out) => out.sourceId === edge.targetId && out.targetId === target.id))) return { edits: [] };
    const id = nanoid(); const mode = targetHandle === 'end_frame' ? 'start' : 'end';
    return { extractorId: id, edits: [
      { kind: 'add_node', id, node: { type: 'frameExtractor', x: Math.round((source.x + source.w + target.x) / 2 - 100), y: Math.round((source.y + target.y) / 2),
        title: mode === 'end' ? '抽尾帧' : '抽首帧', params: { mode } } },
      edgeEdit(source.id, id, sourceHandle, 'video_in'), edgeEdit(id, target.id, 'frame_out', targetHandle || 'start_frame'),
    ] };
  }
  const edits = [edgeEdit(source.id, target.id, sourceHandle, targetHandle)];
  const params = connectionMentionParams(source, target, targetHandle);
  if (params && JSON.stringify(params) !== JSON.stringify(target.params))
    edits.push({ kind: 'update_node', id: target.id, patch: { params } });
  return { edits };
}

export async function connectNodes(sessionId: string, sourceId: string, targetId: string, sourceHandle?: string | null, targetHandle?: string | null): Promise<void> {
  const source = nodeById(sessionId, sourceId); const target = nodeById(sessionId, targetId); if (!source || !target) return;
  const plan = planConnection(sessionId, source, target, sourceHandle, targetHandle);
  await editCommands.commit(sessionId, plan.edits);
  if (plan.extractorId && source.output?.assets?.length) void extractFrameForNode(sessionId, plan.extractorId).catch((error) => toast.error('抽帧失败', String(error)));
}

/** One creation intent keeps its IDs and receipt until success, including a UI retry. */
export function prepareNodeCreation(sessionId: string, spec: CanvasNodeSpec, link?: {
  sourceId?: string; targetId?: string; sourceHandle?: string | null; targetHandle?: string | null;
}): () => Promise<string> {
  const id = nanoid();
  const created = { ...spec, params: spec.params ?? {} };
  const edits: CanvasEdit[] = [{ kind: 'add_node', id, node: created }];
  if (link?.sourceId) {
    const source = nodeById(sessionId, link.sourceId);
    if (!source) throw new Error('原节点已不存在');
    const params = connectionMentionParams(source, { type: spec.type, params: created.params as CanvasNodeParams }, link.targetHandle);
    if (params) created.params = params;
    edits.push(edgeEdit(link.sourceId, id, link.sourceHandle, link.targetHandle));
  } else if (link?.targetId) {
    const target = nodeById(sessionId, link.targetId);
    if (!target) throw new Error('原节点已不存在');
    const params = connectionMentionParams({ id, type: spec.type, title: spec.title }, target, link.targetHandle);
    edits.push(edgeEdit(id, link.targetId, link.sourceHandle, link.targetHandle));
    if (params) edits.push({ kind: 'update_node', id: target.id, patch: { params } });
  }
  const apply = editCommands.prepare(sessionId, edits);
  return async () => { await apply(); return id; };
}

/** A starter pair is one user intent: both nodes and their wire share a receipt and undo. */
export function prepareStarterPair(sessionId: string, source: CanvasNodeSpec, target: CanvasNodeSpec, link?: {
  sourceHandle?: string | null; targetHandle?: string | null;
}): () => Promise<[string, string]> {
  const sourceId = nanoid();
  const targetId = nanoid();
  const apply = editCommands.prepare(sessionId, [
    { kind: 'add_node', id: sourceId, node: source },
    { kind: 'add_node', id: targetId, node: target },
    edgeEdit(sourceId, targetId, link?.sourceHandle, link?.targetHandle),
  ]);
  return async () => { await apply(); return [sourceId, targetId]; };
}

export async function addNodeAndConnect(sessionId: string, spec: CanvasNodeSpec, sourceId: string,
  sourceHandle?: string | null, targetHandle?: string | null): Promise<string | null> {
  return prepareNodeCreation(sessionId, spec, { sourceId, sourceHandle, targetHandle })();
}

/**
 * Creates a new upstream node and connects it TO an existing target node.
 * Used when dragging backwards from an input handle.
 */
export async function addNodeAndConnectToTarget(sessionId: string, spec: CanvasNodeSpec, targetId: string,
  targetHandle?: string | null, sourceHandle?: string | null): Promise<string | null> {
  return prepareNodeCreation(sessionId, spec, { targetId, targetHandle, sourceHandle })();
}

export async function removeEdge(sessionId: string, edgeId: string): Promise<void> {
  const edge = edgesForSession(sessionId).find((e) => e.id === edgeId);
  if (!edge) return;
  const target = nodeById(sessionId, edge.targetId);
  const source = nodeById(sessionId, edge.sourceId);
  const key = target ? mentionPromptKey(target.type) : null;
  const edits: CanvasEdit[] = [{ kind: 'delete_edge', id: edgeId }];
  if (target && source && key && shouldSyncMentionOnEdge(edge.targetHandle, source.type)) {
    const params = target.params as Record<string, unknown>;
    const text = typeof params[key] === 'string' ? params[key] as string : '';
    const next = stripMentionToken(text, source.id);
    if (next !== text) edits.push({ kind: 'update_node', id: target.id, patch: { params: { ...params, [key]: next } } });
  }
  await editCommands.commit(sessionId, edits);
}

/**
 * Split an existing edge by inserting a compact Reroute knot at `at`.
 * The original edge (A -> B) is replaced with (A -> Reroute) and (Reroute -> B).
 * Supported with full undo/redo.
 */
export async function insertRerouteNode(sessionId: string, edgeId: string, at: { x: number; y: number }): Promise<string | null> {
  const edge = edgesForSession(sessionId).find((e) => e.id === edgeId);
  if (!edge) return null;
  const id = nanoid();
  await editCommands.commit(sessionId, [
    { kind: 'delete_edge', id: edgeId },
    { kind: 'add_node', id, node: { type: 'reroute', x: Math.round(at.x - 10), y: Math.round(at.y - 10), w: 20, h: 20, title: '' } },
    edgeEdit(edge.sourceId, id, edge.sourceHandle, null), edgeEdit(id, edge.targetId, null, edge.targetHandle),
  ]);
  return id;
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
  const edits = Object.entries(positions).filter(([id]) => nodeById(sessionId, id)).map(([id, position]): CanvasEdit => ({
    kind: 'update_node', id, patch: { x: Math.round(position.x), y: Math.round(position.y) },
  }));
  void editCommands.commit(sessionId, edits).catch((error) => toast.error('排列失败', String(error)));
}

/** Container box that wraps `members` with comfortable padding on all sides. */
const GROUP_PADDING = 36;

function groupBox(members: CanvasNode[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    const box = defaultNodeBox(n.type);
    const nw = n.w || box.w;
    const nh = n.h || box.h;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + nw);
    maxY = Math.max(maxY, n.y + nh);
  }
  return {
    x: Math.round(minX - GROUP_PADDING),
    y: Math.round(minY - GROUP_PADDING),
    w: Math.round(maxX - minX + GROUP_PADDING * 2),
    h: Math.round(maxY - minY + GROUP_PADDING * 2),
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
    title: '新建组',
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

export async function collapseToSubgraph(sessionId: string, memberIds: string[], title?: string): Promise<string | null> {
  const nodes = (state.nodesBySession[sessionId] ?? []).filter((node) => memberIds.includes(node.id) && node.type !== 'subgraph');
  if (nodes.length < 2) return null;
  const ids = new Set(nodes.map((node) => node.id));
  const edges = edgesForSession(sessionId);
  const inner = edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  const inbound = edges.filter((edge) => !ids.has(edge.sourceId) && ids.has(edge.targetId));
  const outbound = edges.filter((edge) => ids.has(edge.sourceId) && !ids.has(edge.targetId));
  const id = nanoid();
  const edits: CanvasEdit[] = [
    ...nodes.map((node): CanvasEdit => ({ kind: 'delete_node', id: node.id })),
    { kind: 'add_node', id, node: { type: 'subgraph', x: Math.round(nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length),
      y: Math.round(nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length), w: 280, h: 190,
      title: title || `复合子图 ${(state.nodesBySession[sessionId] ?? []).filter((n) => n.type === 'subgraph').length + 1}`,
      params: { collapsed: true, innerNodeIds: nodes.map((n) => n.id), innerSnapshot: { nodes, edges: inner },
        boundaryEdges: [...inbound, ...outbound], description: `包含 ${nodes.length} 个节点的模块` } } },
  ];
  // Several inner ports may share one external node; one visible edge represents that boundary.
  for (const sourceId of new Set(inbound.map((edge) => edge.sourceId))) {
    const edge = inbound.find((edge) => edge.sourceId === sourceId);
    edits.push(edgeEdit(sourceId, id, edge.sourceHandle, 'input'));
  }
  for (const targetId of new Set(outbound.map((edge) => edge.targetId))) {
    const edge = outbound.find((edge) => edge.targetId === targetId);
    edits.push(edgeEdit(id, targetId, 'output', edge.targetHandle));
  }
  await editCommands.commit(sessionId, edits);
  return id;
}

export async function unpackSubgraph(sessionId: string, subgraphId: string): Promise<string[]> {
  const subgraph = nodeById(sessionId, subgraphId);
  if (!subgraph || subgraph.type !== 'subgraph') return [];
  const params = subgraph.params as CanvasSubgraphParams;
  const snapshot = params.innerSnapshot;
  if (!snapshot?.nodes?.length) { await removeNode(sessionId, subgraphId); return []; }
  const mapping = new Map(snapshot.nodes.map((node) => [node.id, nodeById(sessionId, node.id) ? nanoid() : node.id]));
  const edits: CanvasEdit[] = [{ kind: 'delete_node', id: subgraphId }, ...snapshot.nodes.map((node): CanvasEdit => {
    const restored = restoreNodeEdit({ ...node, id: mapping.get(node.id), params: remapParams(node.params, mapping) });
    return restored;
  })];
  for (const edge of snapshot.edges) edits.push(edgeEdit(mapping.get(edge.sourceId), mapping.get(edge.targetId), edge.sourceHandle, edge.targetHandle));
  const visible = edgesForSession(sessionId);
  if (params.boundaryEdges) {
    for (const edge of params.boundaryEdges) {
      const sourceId = mapping.get(edge.sourceId) ?? edge.sourceId;
      const targetId = mapping.get(edge.targetId) ?? edge.targetId;
      const outer = mapping.has(edge.sourceId) ? edge.targetId : edge.sourceId;
      if (visible.some((e) => e.sourceId === outer && e.targetId === subgraphId || e.sourceId === subgraphId && e.targetId === outer))
        edits.push(edgeEdit(sourceId, targetId, edge.sourceHandle, edge.targetHandle));
    }
  } else {
    for (const edge of visible) {
      if (edge.targetId === subgraphId) edits.push(edgeEdit(edge.sourceId, mapping.get(snapshot.nodes[0].id), edge.sourceHandle, 'input'));
      if (edge.sourceId === subgraphId) edits.push(edgeEdit(mapping.get(snapshot.nodes.at(-1).id), edge.targetId, 'output', edge.targetHandle));
    }
  }
  await editCommands.commit(sessionId, edits);
  return [...mapping.values()];
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
  const selected = all.filter((node) => nodeIds.includes(node.id));
  const singleGroup = selected.length === 1 && selected[0].type === 'group' ? selected[0] : undefined;
  const targets = singleGroup ? all.filter((node) => groupMemberIds(sessionId, singleGroup.id).includes(node.id)) : selected.filter((node) => node.type !== 'group');
  if (targets.length < 2) return;
  const positions = gridArrange(targets, singleGroup ? { center: { x: singleGroup.x + singleGroup.w / 2, y: singleGroup.y + singleGroup.h / 2 } } : undefined);
  const projected = all.map((node) => positions[node.id] ? { ...node, ...positions[node.id] } : node);
  const edits: CanvasEdit[] = Object.entries(positions).map(([id, position]) => ({ kind: 'update_node', id, patch: position }));
  const groups = all.filter((node) => node.type === 'group' && ((node.params as CanvasGroupParams).memberIds ?? []).some((id) => positions[id]));
  for (const group of groups) {
    const ids = groupMemberIds(sessionId, group.id);
    const members = projected.filter((node) => ids.includes(node.id));
    if (members.length) edits.push({ kind: 'update_node', id: group.id, patch: groupBox(members) });
  }
  await editCommands.commit(sessionId, edits);
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
  await _setBox(sessionId, groupId, box);
}

export async function duplicateSelectedNodes(sessionId: string, nodeIds: string[]): Promise<string[]> {
  const nodes = (state.nodesBySession[sessionId] ?? []).filter((node) => nodeIds.includes(node.id));
  const mapping = new Map(nodes.map((node) => [node.id, nanoid()]));
  const edits: CanvasEdit[] = nodes.map((node) => ({ kind: 'add_node', id: mapping.get(node.id),
    node: { type: node.type, x: node.x + 36, y: node.y + 36, w: node.w, h: node.h,
      title: node.title ? `${node.title} (副本)` : '', params: remapParams(node.params, mapping) } }));
  for (const edge of edgesForSession(sessionId)) {
    if (mapping.has(edge.sourceId) && mapping.has(edge.targetId))
      edits.push(edgeEdit(mapping.get(edge.sourceId), mapping.get(edge.targetId), edge.sourceHandle, edge.targetHandle));
  }
  await editCommands.commit(sessionId, edits);
  return [...mapping.values()];
}

function remapParams(params: CanvasNodeParams, ids: Map<string, string>): CanvasNodeParams {
  const result = { ...params } as Record<string, unknown>;
  for (const key of ['prompt', 'content', 'instruction']) {
    if (typeof result[key] === 'string') result[key] = (result[key] as string).replace(/\(canvas:([A-Za-z0-9_-]+)\)/g,
      (token, id) => ids.has(id) ? `(canvas:${ids.get(id)})` : token);
  }
  for (const key of ['memberIds', 'refNodeIds', 'innerNodeIds']) if (Array.isArray(result[key]))
    result[key] = (result[key] as string[]).map((id) => ids.get(id) ?? id);
  return result;
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

export async function refinePrompt(
  prompt: string,
  mode: 'image' | 'video' = 'image',
): Promise<string> {
  return api.refineCanvasPrompt(prompt, mode);
}

export async function importImage(sessionId: string, file: File, at: { x: number; y: number }): Promise<CanvasNode | null> {
  // Chat paste/drop works before the user ever opens the canvas drawer.
  await ensureCanvasLoaded(sessionId);
  const id = canvasId(sessionId);
  if (!id) throw new Error('图片附件初始化失败，请重试');
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const fence = captureProjectionFence(sessionId, id);
  const node = await api.importCanvasImage(id, {
    name: file.name || 'image.png',
    dataBase64: btoa(binary),
    x: at.x,
    y: at.y,
  });
  await applyResponseEvent(sessionId, { type: 'node_added', node }, fence);
  recordCreated(sessionId, [node]);
  return node;
}

/** Reuse one immutable media version as imported media or a fixed reference anchor. */
export async function reuseAsset(sessionId: string, input: api.ReuseCanvasAssetInput, operationId = nanoid()): Promise<CanvasNode | null> {
  const id = canvasId(sessionId);
  if (!id) return null;
  const fence = captureProjectionFence(sessionId, id);
  const result = await api.reuseCanvasAsset(id, input, operationId);
  await applyResponseEvent(sessionId, { type: 'node_added', node: result.node }, fence);
  let currentId = result.node.id;
  record(sessionId, {
    undo: () => _deleteNode(sessionId, currentId),
    redo: async () => {
      const nextFence = captureProjectionFence(sessionId, id);
      const next = await api.reuseCanvasAsset(id, { assetId: result.asset.id, x: input.x, y: input.y, title: input.title, asReference: input.asReference }, nanoid());
      await applyResponseEvent(sessionId, { type: 'node_added', node: next.node }, nextFence);
      currentId = next.node.id;
    },
  });
  spotlight(sessionId, [currentId]);
  return result.node;
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
  const fence = captureProjectionFence(sessionId, id);
  const node = await api.importCanvasImage(id, {
    name: file.name || 'anchor.png',
    dataBase64: btoa(binary),
    x: at.x,
    y: at.y,
    type: 'anchor',
    params: { role: 'character', strength: 'mid' },
  });
  await applyResponseEvent(sessionId, { type: 'node_added', node }, fence);
  recordCreated(sessionId, [node]);
  return node.id;
}

/**
 * Wire a reference anchor into every image/video node in `targetIds` (skipping
 * ones already connected), as one history entry. Returns how many edges landed.
 */
export async function attachAnchor(sessionId: string, anchorId: string, targetIds: string[]): Promise<number> {
  const edges = edgesForSession(sessionId);
  const edits: CanvasEdit[] = [];
  for (const targetId of new Set(targetIds)) {
    const target = nodeById(sessionId, targetId);
    if (!target || !['image', 'video'].includes(target.type) || edges.some((e) => e.sourceId === anchorId && e.targetId === targetId)) continue;
    const occupied = new Set(edges.filter((edge) => edge.targetId === targetId).map((edge) => edge.targetHandle));
    const slot = [1, 2, 3].find((slot) => !occupied.has(`ref_${slot}`));
    if (slot) edits.push(edgeEdit(anchorId, targetId, null, `ref_${slot}`));
  }
  await editCommands.commit(sessionId, edits);
  return edits.length;
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
export async function extractVideoFrame(sessionId: string, videoNodeId: string, pick: FramePick, currentTime = 0, assetIndex = 0): Promise<string | null> {
  const source = nodeById(sessionId, videoNodeId); if (!source || source.type !== 'video') return null;
  const assets = source.output?.assets ?? [];
  const path = assets[Math.min(assetIndex, assets.length - 1)]; if (!path) return null;
  const blob = await grabVideoFrameBlob(await api.canvasAssetUrl(path), pick, currentTime);
  const id = nanoid(); const label = pick === 'start' ? '镜头首帧' : pick === 'end' ? '镜头尾帧' : '镜头选帧';
  await commitUploads(sessionId, [{ kind: 'add_node', id, node: { type: 'image', x: source.x + source.w + 56, y: source.y + (pick === 'start' ? 0 : pick === 'end' ? 80 : 160),
    title: label, params: { prompt: '', extractedFrom: { nodeId: videoNodeId, asset: path, pick, currentTime } } } }, edgeEdit(videoNodeId, id)],
    [{ nodeId: id, name: `${label}.png`, mimeType: 'image/png', dataBase64: await blobToBase64(blob) }]);
  return id;
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
  const rel = assets[sourceNode.output?.activeAssetIndex ?? 0];
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

  const fence = captureProjectionFence(sessionId, id);
  const updatedNode = await api.setCanvasNodeAsset(id, frameExtractorNodeId, {
    name: `frame-${mode}.png`,
    dataBase64: btoa(binary),
  });
  await applyResponseEvent(sessionId, { type: 'node_updated', node: updatedNode }, fence);
}

export async function saveAsset(sessionId: string, nodeId: string, assetIndex = 0): Promise<void> {
  const id = canvasId(sessionId);
  if (id) await api.saveCanvasAsset(id, nodeId, assetIndex);
}

export async function uploadAssetToNode(sessionId: string, nodeId: string, file: File): Promise<void> {
  const id = canvasId(sessionId);
  if (!id) return;
  const dataBase64 = await blobToBase64(file);
  const fence = captureProjectionFence(sessionId, id);
  const updatedNode = await api.setCanvasNodeAsset(id, nodeId, {
    name: file.name,
    dataBase64,
  });
  await applyResponseEvent(sessionId, { type: 'node_updated', node: updatedNode }, fence);
}

async function commitUploads(sessionId: string, edits: CanvasEdit[], uploads: CanvasEditUpload[]): Promise<CanvasSnapshot> {
  const id = canvasId(sessionId);
  if (!id) throw new Error('画布尚未加载');
  return editCommands.commitWithResult(sessionId, edits, () => api.editCanvasWithUploads(id, edits, uploads, nanoid()), uploads);
}

function recordCreated(sessionId: string, nodes: CanvasNode[], edges: CanvasEdge[] = []): void {
  editCommands.recordExisting(sessionId, nodes.map((node) => ({ kind: 'delete_node', id: node.id })),
    [...nodes.map(restoreNodeEdit), ...edges.map((edge): CanvasEdit => ({ kind: 'add_edge', edge }))]);
}

const EDIT_NODE_GAP = 80;

/**
 * 从源图节点派生一次编辑：建新 image 节点 + edge(image_out → edit_src)。
 * 本地类在客户端算像素并上传；模型类上传蒙版（若有）后 runNode。
 */
export async function deriveImageEdit(sessionId: string, sourceNodeId: string, spec: Omit<ImageEditSpec, 'sourceNodeId'>,
  opts?: { localResultBlob?: Blob; maskBlob?: Blob }): Promise<string | null> {
  const source = nodeById(sessionId, sourceNodeId);
  if (!source) return null;
  const params = source.params as CanvasImageParams;
  const id = nanoid();
  const edits: CanvasEdit[] = [{ kind: 'add_node', id, node: { type: 'image', x: source.x + source.w + EDIT_NODE_GAP, y: source.y,
    title: editNodeTitle(spec.kind), params: { prompt: '', size: params.size ?? '1024x1024', model: params.model, edit: { ...spec, sourceNodeId } } } },
    edgeEdit(sourceNodeId, id, 'image_out', 'edit_src')];
  const uploads: CanvasEditUpload[] = [];
  if (opts?.localResultBlob) uploads.push({ nodeId: id, name: `${spec.kind}.png`, mimeType: 'image/png', dataBase64: await blobToBase64(opts.localResultBlob) });
  if (EDIT_META[spec.kind].needsMask && opts?.maskBlob) uploads.push({ nodeId: id, name: 'mask.png', mimeType: 'image/png', role: 'mask', dataBase64: await blobToBase64(opts.maskBlob) });
  if (uploads.length) await commitUploads(sessionId, edits, uploads); else await editCommands.commit(sessionId, edits);
  if (!isLocalEdit(spec.kind) && !opts?.localResultBlob) await runNode(sessionId, id);
  return id;
}

/**
 * 就地改写已有编辑节点的 params.edit，可选上传新像素/蒙版后重跑。
 * 不建新节点。
 */
export async function reviseImageEdit(
  sessionId: string,
  nodeId: string,
  patch: Partial<Pick<ImageEditSpec, 'params' | 'instruction' | 'cropRect' | 'maskAsset' | 'regions'>>,
  opts?: { localResultBlob?: Blob; maskBlob?: Blob; rerun?: boolean },
): Promise<void> {
  const node = nodeById(sessionId, nodeId);
  if (!node) return;
  const params = (node.params as CanvasImageParams) ?? { prompt: '', size: '1024x1024' };
  if (!params.edit) return;
  const nextEdit: ImageEditSpec = { ...params.edit, ...patch };
  const edits: CanvasEdit[] = [{ kind: 'update_node', id: nodeId, patch: { params: { ...params, edit: nextEdit } } }];
  const uploads: CanvasEditUpload[] = [];
  if (opts?.maskBlob) uploads.push({ nodeId, name: 'mask.png', mimeType: 'image/png', role: 'mask', dataBase64: await blobToBase64(opts.maskBlob) });
  if (isLocalEdit(nextEdit.kind) && opts?.localResultBlob) uploads.push({ nodeId, name: `${nextEdit.kind}.png`, mimeType: 'image/png', dataBase64: await blobToBase64(opts.localResultBlob) });
  if (uploads.length) await commitUploads(sessionId, edits, uploads); else await editCommands.commit(sessionId, edits);
  if (isLocalEdit(nextEdit.kind)) return;
  if (opts?.rerun === false) return;
  await runNode(sessionId, nodeId);
}

/** 快速切分：源图切成 N 块，每块建一个 image 节点。一条 undo 记录包住全部。 */
export async function deriveImageSplit(sessionId: string, sourceNodeId: string, grid: '2x2' | '3x3' | '4x4', tiles: Blob[]): Promise<string[]> {
  const source = nodeById(sessionId, sourceNodeId);
  if (!source || !tiles.length) return [];
  const cols = grid === '2x2' ? 2 : grid === '3x3' ? 3 : 4;
  const box = defaultNodeBox('image');
  const ids = tiles.map(() => nanoid());
  const params = source.params as CanvasImageParams;
  const edits: CanvasEdit[] = ids.flatMap((id, i) => [
    { kind: 'add_node' as const, id, node: { type: 'image' as const, x: source.x + source.w + EDIT_NODE_GAP + (i % cols) * (box.w + EDIT_NODE_GAP),
      y: source.y + Math.floor(i / cols) * (box.h + EDIT_NODE_GAP), title: `切分 ${i + 1}`,
      params: { prompt: '', size: params.size ?? '1024x1024', edit: { kind: 'split', sourceNodeId, params: { grid } } } } },
    edgeEdit(sourceNodeId, id, 'image_out', 'edit_src'),
  ]);
  const uploads = await Promise.all(tiles.map(async (tile, i): Promise<CanvasEditUpload> => ({ nodeId: ids[i], name: `split-${i + 1}.png`,
    mimeType: 'image/png', dataBase64: await blobToBase64(tile) })));
  await commitUploads(sessionId, edits, uploads);
  return ids;
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
    const { snap, acknowledgedVersion } = await readCanvasSnapshot(sessionId);
    ingestSnapshot(sessionId, snap, syncCursorBySession.get(sessionId)?.epoch ?? null, false, acknowledgedVersion);
    const ids = new Set(createdIds);
    recordCreated(sessionId, snap.nodes.filter((node) => ids.has(node.id)), snap.edges.filter((edge) => ids.has(edge.sourceId) || ids.has(edge.targetId)));
  }
  return { warnings: res.warnings ?? [], count: createdIds.length };
}

const pendingSelection = new Map<string, string[]>();

export function setSelection(sessionId: string, ids: string[]): void {
  const current = state.selectedNodeIdsBySession[sessionId] ?? EMPTY_SELECTED_IDS;
  const isSame = current.length === ids.length && current.every((id, i) => id === ids[i]);
  if (!isSame) {
    setState({
      selectedNodeIdsBySession: {
        ...state.selectedNodeIdsBySession,
        [sessionId]: ids,
      },
    });
  }
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

/** Clears canvas selection both in store and notifies CanvasPanel. */
export function clearSelection(sessionId: string): void {
  setSelection(sessionId, []);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reizo:clear-canvas-selection', { detail: { sessionId } }));
  }
}

/** Removes a single node from the canvas selection. */
export function deselectNode(sessionId: string, nodeId: string): void {
  const current = state.selectedNodeIdsBySession[sessionId] ?? [];
  const next = current.filter((id) => id !== nodeId);
  setSelection(sessionId, next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reizo:deselect-canvas-node', { detail: { sessionId, nodeId } }));
  }
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
  const proposals = state.proposalsBySession[sessionId] ?? [];
  const edits = proposals.filter((id) => nodeById(sessionId, id)).map((id): CanvasEdit => ({ kind: 'delete_node', id }));
  await editCommands.commit(sessionId, edits);
  setProposals(sessionId, []);


}


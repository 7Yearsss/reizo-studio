import { nanoid } from 'nanoid';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Canvas,
  CanvasEdge,
  CanvasNode,
  CanvasNodeOutput,
  CanvasNodeParams,
  CanvasNodeType,
  CanvasSnapshot,
  NodeRunState,
} from '../../../shared/canvas';
import type { DbHandle } from '../db/client';
import { descendants, inputHash, wouldCycle } from '../canvas/graph';
import { isPortCompatible, normalizeSourceHandle } from '../../../shared/canvasGraph';
import type { CanvasCommit, CanvasDocumentChange } from '../../../shared/canvasSync';
import { isCanvasCommit } from '../../../shared/canvasSync';
import { createCanvasJobStore } from './canvasJobStore';
import { createCanvasAssetStore } from './canvasAssetStore';

export const CANVAS_COMMIT_RETENTION = 1000;

interface CanvasRowRaw {
  id: string;
  session_id: string;
  live_revision: number;
  created_at: number;
  updated_at: number;
}

interface NodeRowRaw {
  id: string;
  canvas_id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  params_json: string;
  params_hash: string | null;
  run_state: string;
  output_json: string | null;
  updated_at: number;
}

interface EdgeRowRaw {
  id: string;
  canvas_id: string;
  source_id: string;
  source_handle: string | null;
  target_id: string;
  target_handle: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toCanvas(row: CanvasRowRaw): Canvas {
  return {
    id: row.id,
    sessionId: row.session_id,
    liveRevision: row.live_revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toNode(row: NodeRowRaw): CanvasNode {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    type: row.type as CanvasNodeType,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    title: row.title,
    params: parseJson<CanvasNodeParams>(row.params_json, {}),
    paramsHash: row.params_hash,
    runState: row.run_state as NodeRunState,
    output: row.output_json ? parseJson<CanvasNodeOutput>(row.output_json, {}) : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toEdge(row: EdgeRowRaw & { source_type?: string }): CanvasEdge {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    sourceId: row.source_id,
    // Heal legacy rows that stored a generic handle name (e.g. "output"):
    // React Flow silently drops edges whose sourceHandle matches no rendered handle.
    sourceHandle: normalizeSourceHandle(row.source_type ?? '', row.source_handle),
    targetId: row.target_id,
    targetHandle: row.target_handle,
  };
}

export interface NodeInput {
  type: CanvasNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  params?: CanvasNodeParams;
}

export interface NodePatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  title?: string;
  params?: CanvasNodeParams;
  runState?: NodeRunState;
  output?: CanvasNodeOutput | null;
  /** The input hash captured at the moment of a successful run. */
  paramsHash?: string | null;
}

/** Flat result — this project has weak (non-strict) discriminated-union narrowing. */
export interface AddEdgeResult {
  edge?: CanvasEdge;
  rev?: number;
  error?: 'missing' | 'cycle' | 'incompatible';
}

export interface EdgeInput {
  sourceId: string;
  sourceHandle?: string | null;
  targetId: string;
  targetHandle?: string | null;
}

/**
 * SQLite-backed canvas store. Like `sqliteSessionStore` it writes straight
 * through `node:sqlite` (the drizzle proxy has no `transaction()`), and every
 * outer transaction allocates one `live_revision` per affected canvas and
 * persists its complete document commit alongside the row changes. Readers
 * can replay that journal or resync when their cursor is outside retention.
 */
export function createCanvasStore(handle: DbHandle) {
  const raw: DatabaseSync = handle.raw;

  const selCanvasById = raw.prepare('SELECT * FROM canvases WHERE id = ?');
  const selCanvasBySession = raw.prepare('SELECT * FROM canvases WHERE session_id = ?');
  const selNodes = raw.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? ORDER BY updated_at');
  const selNode = raw.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? AND id = ?');
  const selEdges = raw.prepare(
    'SELECT e.*, sn.type AS source_type FROM canvas_edges e LEFT JOIN canvas_nodes sn ON sn.id = e.source_id WHERE e.canvas_id = ?',
  );
  const bumpRev = raw.prepare(
    'UPDATE canvases SET live_revision = live_revision + 1, updated_at = ? WHERE id = ?',
  );
  const readRev = raw.prepare('SELECT live_revision AS r FROM canvases WHERE id = ?');

  interface TransactionFrame {
    revisions: Map<string, number>;
    changes: Map<string, CanvasDocumentChange[]>;
    dirtyRoots: Map<string, Set<string>>;
    context?: { canvasId: string; mutationId?: string };
  }
  const transactions: TransactionFrame[] = [];
  const commitListeners = new Set<(commit: CanvasCommit) => void>();
  const notifications: CanvasCommit[] = [];
  let notifying = false;

  function notify(commits: CanvasCommit[]): void {
    notifications.push(...commits);
    if (notifying || !notifications.length) return;
    notifying = true;
    queueMicrotask(() => {
      try {
        while (notifications.length) {
          const commit = notifications.shift();
          for (const listener of [...commitListeners]) {
            try { listener(commit); } catch (err) { console.error('[canvas] commit observer failed', err); }
          }
        }
      } finally { notifying = false; }
    });
  }

  function change(canvasId: string, event: CanvasDocumentChange, dirtyRoot?: string): void {
    const frame = transactions[transactions.length - 1];
    const changes = frame.changes.get(canvasId) ?? [];
    changes.push(event);
    frame.changes.set(canvasId, changes);
    if (dirtyRoot) {
      const roots = frame.dirtyRoots.get(canvasId) ?? new Set<string>();
      roots.add(dirtyRoot);
      frame.dirtyRoots.set(canvasId, roots);
    }
  }

  function nextRev(canvasId: string): number {
    for (let i = transactions.length - 1; i >= 0; i -= 1) {
      const revision = transactions[i].revisions.get(canvasId);
      if (revision !== undefined) return revision;
    }
    bumpRev.run(Date.now(), canvasId);
    const revision = (readRev.get(canvasId) as { r: number }).r;
    transactions[transactions.length - 1].revisions.set(canvasId, revision);
    return revision;
  }

  function readNode(canvasId: string, id: string): CanvasNode | null {
    const row = selNode.get(canvasId, id) as unknown as NodeRowRaw | undefined;
    return row ? toNode(row) : null;
  }

  function readNodes(canvasId: string): CanvasNode[] {
    return (selNodes.all(canvasId) as unknown as NodeRowRaw[]).map(toNode);
  }

  function readEdges(canvasId: string): CanvasEdge[] {
    return (selEdges.all(canvasId) as unknown as EdgeRowRaw[]).map(toEdge);
  }

  /** Set the derived `dirty` flag: ran before, but inputs have drifted since. */
  function annotate(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    return nodes.map((node) => {
      if (!node.paramsHash) return { ...node, dirty: false };
      const upstream = edges
        .filter((e) => e.targetId === node.id)
        .map((e) => byId.get(e.sourceId))
        .filter((n): n is CanvasNode => Boolean(n));
      return { ...node, dirty: node.paramsHash !== inputHash(node, upstream) };
    });
  }

  function ensureCanvas(sessionId: string): Canvas {
    const existing = selCanvasBySession.get(sessionId) as unknown as CanvasRowRaw | undefined;
    if (existing) return toCanvas(existing);
    const id = nanoid();
    const now = Date.now();
    raw
      .prepare('INSERT INTO canvases (id, session_id, live_revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(id, sessionId, now, now);
    return toCanvas(selCanvasById.get(id) as unknown as CanvasRowRaw);
  }

  function tx<T>(fn: () => T, context?: { canvasId: string; mutationId?: string }): T {
    const savepoint = `canvas_${transactions.length}`;
    const parent = transactions[transactions.length - 1];
    const outer = !parent;
    const frame: TransactionFrame = { revisions: new Map(), changes: new Map(), dirtyRoots: new Map(), context };
    raw.exec(outer ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    transactions.push(frame);
    const commits: CanvasCommit[] = [];
    let out: T;
    try {
      out = fn();
      if (out && typeof (out as { then?: unknown }).then === 'function') {
        throw new Error('Canvas transactions must be synchronous');
      }
      if (outer) {
        for (const [canvasId, changes] of frame.changes) {
          const revision = frame.revisions.get(canvasId);
          const roots = frame.dirtyRoots.get(canvasId) ?? new Set<string>();
          // Dirty is derived: an upstream result/edge change also affects untouched descendants.
          const edges = readEdges(canvasId);
          const affected = new Set<string>();
          for (const root of roots) {
            affected.add(root);
            for (const id of descendants(edges, root)) affected.add(id);
          }
          const seen = new Set<string>();
          const annotated = affected.size ? annotate(readNodes(canvasId), edges) : [];
          const byId = new Map(annotated.map((node) => [node.id, node]));
          const finalNode = (node: CanvasNode): CanvasNode => {
            const current = byId.get(node.id) ?? readNode(canvasId, node.id) ?? node;
            if (byId.has(node.id)) return current;
            if (!current.paramsHash) return { ...current, dirty: false };
            const upstream = edges.filter((edge) => edge.targetId === current.id)
              .map((edge) => readNode(canvasId, edge.sourceId)).filter((n): n is CanvasNode => Boolean(n));
            return { ...current, dirty: current.paramsHash !== inputHash(current, upstream) };
          };
          const projected = changes.map((event): CanvasDocumentChange => {
            if (event.type === 'node_added' || event.type === 'node_updated') {
              seen.add(event.node.id);
              return { ...event, node: finalNode(event.node) };
            }
            return event;
          });
          for (const id of affected) {
            const node = byId.get(id);
            if (node && !seen.has(id)) projected.push({ type: 'node_updated', node });
          }
          const commit: CanvasCommit = {
            canvasId, revision, changes: projected,
            ...(context?.canvasId === canvasId && context.mutationId ? { mutationId: context.mutationId } : {}),
          };
          raw.prepare('INSERT INTO canvas_commits (canvas_id, revision, mutation_id, changes_json, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(canvasId, revision, commit.mutationId ?? null, JSON.stringify(projected), Date.now());
          raw.prepare('DELETE FROM canvas_commits WHERE canvas_id = ? AND revision <= ?')
            .run(canvasId, revision - CANVAS_COMMIT_RETENTION);
          commits.push(commit);
        }
      }
      raw.exec(outer ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    } catch (err) {
      raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
      if (!outer) raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw err;
    } finally {
      transactions.pop();
    }
    if (parent) {
      for (const [id, revision] of frame.revisions) parent.revisions.set(id, revision);
      for (const [id, changes] of frame.changes) parent.changes.set(id, [...(parent.changes.get(id) ?? []), ...changes]);
      for (const [id, roots] of frame.dirtyRoots) parent.dirtyRoots.set(id, new Set([...(parent.dirtyRoots.get(id) ?? []), ...roots]));
    } else notify(commits);
    return out;
  }

  const jobs = createCanvasJobStore(handle, tx);
  const assets = createCanvasAssetStore(handle, tx, jobs, () => transactions.length > 0);

  return {
    jobs,
    assets,
    ensureCanvas,
    transaction: tx,

    subscribeCommits(listener: (commit: CanvasCommit) => void): () => void {
      commitListeners.add(listener);
      return () => commitListeners.delete(listener);
    },

    readCommitsAfter(canvasId: string, after: number): { revision: number; resync: boolean; commits: CanvasCommit[] } {
      const current = selCanvasById.get(canvasId) as unknown as CanvasRowRaw | undefined;
      const revision = current?.live_revision ?? 0;
      if (!current || !Number.isSafeInteger(after) || after < 0 || after > revision) return { revision, resync: true, commits: [] };
      if (after === revision) return { revision, resync: false, commits: [] };
      const rows = raw.prepare('SELECT revision, mutation_id, changes_json FROM canvas_commits WHERE canvas_id = ? AND revision > ? ORDER BY revision')
        .all(canvasId, after) as { revision: number; mutation_id: string | null; changes_json: string }[];
      if (rows.length !== revision - after || rows.some((row, index) => row.revision !== after + index + 1)) {
        return { revision, resync: true, commits: [] };
      }
      const commits: CanvasCommit[] = [];
      try {
        for (const row of rows) {
          const commit = { canvasId, revision: row.revision, changes: JSON.parse(row.changes_json),
            ...(row.mutation_id ? { mutationId: row.mutation_id } : {}) };
          if (!isCanvasCommit(commit)) return { revision, resync: true, commits: [] };
          commits.push(commit);
        }
      } catch { return { revision, resync: true, commits: [] }; }
      return { revision, resync: false, commits };
    },

    getReceipt(canvasId: string, mutationId: string): { requestHash: string; resultJson: string } | null {
      const row = raw.prepare('SELECT request_hash, result_json FROM canvas_command_receipts WHERE canvas_id = ? AND mutation_id = ?')
        .get(canvasId, mutationId) as { request_hash: string; result_json: string } | undefined;
      return row ? { requestHash: row.request_hash, resultJson: row.result_json } : null;
    },

    saveReceipt(canvasId: string, mutationId: string, requestHash: string, result: unknown): void {
      raw.prepare('INSERT INTO canvas_command_receipts (canvas_id, mutation_id, request_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(canvasId, mutationId, requestHash, JSON.stringify(result), Date.now());
    },

    getCanvas(id: string): Canvas | null {
      const row = selCanvasById.get(id) as unknown as CanvasRowRaw | undefined;
      return row ? toCanvas(row) : null;
    },

    /** Read-only lookup — does not create the canvas row. */
    findCanvasBySession(sessionId: string): Canvas | null {
      const row = selCanvasBySession.get(sessionId) as unknown as CanvasRowRaw | undefined;
      return row ? toCanvas(row) : null;
    },

    getSnapshot(canvasId: string): CanvasSnapshot | null {
      const canvasRow = selCanvasById.get(canvasId) as unknown as CanvasRowRaw | undefined;
      if (!canvasRow) return null;
      const edges = readEdges(canvasId);
      return { canvas: toCanvas(canvasRow), nodes: annotate(readNodes(canvasId), edges), edges };
    },

    getSnapshotBySession(sessionId: string): CanvasSnapshot {
      const canvas = ensureCanvas(sessionId);
      const edges = readEdges(canvas.id);
      return { canvas, nodes: annotate(readNodes(canvas.id), edges), edges };
    },

    getNode: readNode,
    getNodes: readNodes,
    getEdges: readEdges,

    runningNodes(): CanvasNode[] {
      return (raw.prepare("SELECT * FROM canvas_nodes WHERE run_state = 'running'").all() as unknown as NodeRowRaw[]).map(toNode);
    },

    /** The mutated node plus its descendants, each with a fresh `dirty` flag. */
    annotatedFrom(canvasId: string, nodeId: string): CanvasNode[] {
      const nodes = readNodes(canvasId);
      const edges = readEdges(canvasId);
      const annotated = annotate(nodes, edges);
      const affected = descendants(edges, nodeId);
      affected.add(nodeId);
      return annotated.filter((n) => affected.has(n.id));
    },

    addNode(canvasId: string, input: NodeInput): { rev: number; node: CanvasNode } {
      return tx(() => {
        const id = nanoid();
        const now = Date.now();
        raw
          .prepare(
            `INSERT INTO canvas_nodes (id, canvas_id, type, x, y, w, h, title, params_json, run_state, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)`,
          )
          .run(
            id,
            canvasId,
            input.type,
            Math.round(input.x),
            Math.round(input.y),
            Math.round(input.w),
            Math.round(input.h),
            input.title ?? '',
            JSON.stringify(input.params ?? {}),
            now,
          );
        const rev = nextRev(canvasId);
        const saved = readNode(canvasId, id);
        if (!saved) throw new Error("canvas node missing after write");
        change(canvasId, { type: 'node_added', node: saved });
        return { rev, node: saved };
      });
    },

    updateNode(canvasId: string, id: string, patch: NodePatch): { rev: number; node: CanvasNode } | null {
      return tx(() => {
        const current = readNode(canvasId, id);
        if (!current) return null;
        const sets: string[] = [];
        const vals: (string | number | null)[] = [];
        if (patch.x !== undefined) { sets.push('x = ?'); vals.push(Math.round(patch.x)); }
        if (patch.y !== undefined) { sets.push('y = ?'); vals.push(Math.round(patch.y)); }
        if (patch.w !== undefined) { sets.push('w = ?'); vals.push(Math.round(patch.w)); }
        if (patch.h !== undefined) { sets.push('h = ?'); vals.push(Math.round(patch.h)); }
        if (patch.title !== undefined) { sets.push('title = ?'); vals.push(patch.title); }
        if (patch.params !== undefined) { sets.push('params_json = ?'); vals.push(JSON.stringify(patch.params)); }
        if (patch.runState !== undefined) { sets.push('run_state = ?'); vals.push(patch.runState); }
        if (patch.paramsHash !== undefined) { sets.push('params_hash = ?'); vals.push(patch.paramsHash); }
        if (patch.output !== undefined) {
          sets.push('output_json = ?');
          vals.push(patch.output === null ? null : JSON.stringify(patch.output));
        }
        sets.push('updated_at = ?');
        vals.push(Date.now());
        raw.prepare(`UPDATE canvas_nodes SET ${sets.join(', ')} WHERE canvas_id = ? AND id = ?`).run(
          ...vals,
          canvasId,
          id,
        );
        const rev = nextRev(canvasId);
        const saved = readNode(canvasId, id);
        if (!saved) throw new Error("canvas node missing after write");
        change(canvasId, { type: 'node_updated', node: saved },
          patch.params !== undefined || patch.output !== undefined || patch.paramsHash !== undefined ? id : undefined);
        return { rev, node: saved };
      });
    },

    deleteNode(canvasId: string, id: string): { rev: number } | null {
      return tx(() => {
        const current = readNode(canvasId, id);
        if (!current) return null;
        const removedEdges = readEdges(canvasId).filter((edge) => edge.sourceId === id || edge.targetId === id);
        raw.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND (source_id = ? OR target_id = ?)').run(
          canvasId,
          id,
          id,
        );
        raw.prepare('DELETE FROM canvas_nodes WHERE canvas_id = ? AND id = ?').run(canvasId, id);
        const rev = nextRev(canvasId);
        change(canvasId, { type: 'node_deleted', id });
        for (const edge of removedEdges) change(canvasId, { type: 'edge_deleted', id: edge.id }, edge.sourceId === id ? edge.targetId : undefined);
        return { rev };
      });
    },

    addEdge(canvasId: string, input: EdgeInput): AddEdgeResult {
      return tx((): AddEdgeResult => {
        const src = readNode(canvasId, input.sourceId);
        const tgt = readNode(canvasId, input.targetId);
        if (!src || !tgt) return { error: 'missing' };
        const sourceHandle = normalizeSourceHandle(src.type, input.sourceHandle);
        const compat = isPortCompatible(src, tgt, sourceHandle, input.targetHandle);
        if (!compat.valid) {
          return { error: 'incompatible' };
        }
        const existing = readEdges(canvasId);
        if (
          existing.some((e) => e.sourceId === input.sourceId && e.targetId === input.targetId) ||
          wouldCycle(existing, input.sourceId, input.targetId)
        ) {
          return { error: 'cycle' };
        }
        const id = nanoid();
        raw
          .prepare(
            `INSERT INTO canvas_edges (id, canvas_id, source_id, source_handle, target_id, target_handle)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, canvasId, input.sourceId, sourceHandle ?? null, input.targetId, input.targetHandle ?? null);
        const rev = nextRev(canvasId);
        const edgeRow = raw
          .prepare('SELECT * FROM canvas_edges WHERE id = ?')
          .get(id) as unknown as EdgeRowRaw;
        const edge = toEdge({ ...edgeRow, source_type: src.type });
        change(canvasId, { type: 'edge_added', edge }, input.targetId);
        return { rev, edge };
      });
    },

    deleteEdge(canvasId: string, id: string): { rev: number; targetId: string } | null {
      return tx(() => {
        const existing = raw
          .prepare('SELECT target_id AS t FROM canvas_edges WHERE canvas_id = ? AND id = ?')
          .get(canvasId, id) as { t: string } | undefined;
        if (!existing) return null;
        raw.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND id = ?').run(canvasId, id);
        const rev = nextRev(canvasId);
        change(canvasId, { type: 'edge_deleted', id }, existing.t);
        return { rev, targetId: existing.t };
      });
    },

    /** Upstream nodes feeding `nodeId` (one hop), for building an image edit / agent context. */
    upstreamNodes(canvasId: string, nodeId: string): CanvasNode[] {
      const rows = raw
        .prepare(
          `SELECT n.* FROM canvas_nodes n
           JOIN canvas_edges e ON e.source_id = n.id
           WHERE e.canvas_id = ? AND e.target_id = ?`,
        )
        .all(canvasId, nodeId) as unknown as NodeRowRaw[];
      return rows.map(toNode);
    },
  };
}

export type CanvasStore = ReturnType<typeof createCanvasStore>;

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

function toEdge(row: EdgeRowRaw): CanvasEdge {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    sourceId: row.source_id,
    sourceHandle: row.source_handle,
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
  error?: 'missing' | 'cycle';
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
 * mutation bumps `canvases.live_revision` in the same `BEGIN`/`COMMIT` so a
 * reconnecting client can resume from `after = live_revision`.
 */
export function createCanvasStore(handle: DbHandle) {
  const raw: DatabaseSync = handle.raw;

  const selCanvasById = raw.prepare('SELECT * FROM canvases WHERE id = ?');
  const selCanvasBySession = raw.prepare('SELECT * FROM canvases WHERE session_id = ?');
  const selNodes = raw.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? ORDER BY updated_at');
  const selNode = raw.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? AND id = ?');
  const selEdges = raw.prepare('SELECT * FROM canvas_edges WHERE canvas_id = ?');
  const bumpRev = raw.prepare(
    'UPDATE canvases SET live_revision = live_revision + 1, updated_at = ? WHERE id = ?',
  );
  const readRev = raw.prepare('SELECT live_revision AS r FROM canvases WHERE id = ?');

  function nextRev(canvasId: string): number {
    bumpRev.run(Date.now(), canvasId);
    return (readRev.get(canvasId) as { r: number }).r;
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

  function tx<T>(fn: () => T): T {
    raw.exec('BEGIN');
    try {
      const out = fn();
      raw.exec('COMMIT');
      return out;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    ensureCanvas,

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
        return { rev, node: saved };
      });
    },

    deleteNode(canvasId: string, id: string): { rev: number } | null {
      return tx(() => {
        const current = readNode(canvasId, id);
        if (!current) return null;
        raw.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND (source_id = ? OR target_id = ?)').run(
          canvasId,
          id,
          id,
        );
        raw.prepare('DELETE FROM canvas_nodes WHERE canvas_id = ? AND id = ?').run(canvasId, id);
        return { rev: nextRev(canvasId) };
      });
    },

    addEdge(canvasId: string, input: EdgeInput): AddEdgeResult {
      return tx((): AddEdgeResult => {
        const src = readNode(canvasId, input.sourceId);
        const tgt = readNode(canvasId, input.targetId);
        if (!src || !tgt) return { error: 'missing' };
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
          .run(id, canvasId, input.sourceId, input.sourceHandle ?? null, input.targetId, input.targetHandle ?? null);
        const rev = nextRev(canvasId);
        const edgeRow = raw
          .prepare('SELECT * FROM canvas_edges WHERE id = ?')
          .get(id) as unknown as EdgeRowRaw;
        return { rev, edge: toEdge(edgeRow) };
      });
    },

    deleteEdge(canvasId: string, id: string): { rev: number; targetId: string } | null {
      return tx(() => {
        const existing = raw
          .prepare('SELECT target_id AS t FROM canvas_edges WHERE canvas_id = ? AND id = ?')
          .get(canvasId, id) as { t: string } | undefined;
        if (!existing) return null;
        raw.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND id = ?').run(canvasId, id);
        return { rev: nextRev(canvasId), targetId: existing.t };
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

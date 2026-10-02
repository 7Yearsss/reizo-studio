import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defaultNodeBox, type CanvasNodeType } from '../../../shared/canvas';
import type { CanvasEvent } from '../../../shared/canvasStream';
import type { CanvasStore, EdgeInput, NodeInput, NodePatch } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { cancelVideoJob } from './asyncJobManager';
import { nodeJobsFor } from './nodeJobs';
import { canvasWorkStopped } from './workLifecycle';

const nodeTypes: [CanvasNodeType, ...CanvasNodeType[]] = [
  'image', 'agent', 'video', 'audio', 'note', 'group', 'anchor', 'reroute', 'frameExtractor', 'section', 'subgraph',
];
const record = z.record(z.string(), z.unknown());
const nodeInput = z.object({
  type: z.enum(nodeTypes), x: z.number().finite(), y: z.number().finite(),
  w: z.number().finite().positive(), h: z.number().finite().positive(),
  title: z.string().optional(), params: record.optional(),
});
const nodePatch = nodeInput.omit({ type: true }).partial().extend({
  runState: z.enum(['idle', 'running', 'done', 'error']).optional(),
  output: record.nullable().optional(), paramsHash: z.string().nullable().optional(),
});
const edgeInput = z.object({
  sourceId: z.string().min(1), targetId: z.string().min(1),
  sourceHandle: z.string().nullable().optional(), targetHandle: z.string().nullable().optional(),
});
const reuseInput = z.object({ assetId: z.string().min(1), x: z.number().finite().optional(), y: z.number().finite().optional(),
  title: z.string().optional(), asReference: z.boolean().optional() });

export class CanvasCommandError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) { super(message); }
}

// Object key order must not turn a transport retry into a different command.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  }
  return value;
}

interface Effect { rev: number; event: CanvasEvent }
interface Frame { canvasId: string; events: Effect[]; afterCommit: Array<() => void> }

/** Shared write interface for HTTP and agent tools. Network execution stays outside its transactions. */
export function createCanvasApplication(store: CanvasStore, options: {
  publish?: (canvasId: string, rev: number, event: CanvasEvent) => void;
  cancelNode?: (canvasId: string, nodeId: string) => void;
} = {}) {
  const publish = options.publish ?? ((id, rev, event) => getCanvasChannel(id).broadcast(rev, event));
  const cancelNode = options.cancelNode ?? ((id, nodeId) => {
    nodeJobsFor(store).cancelNode(id, nodeId);
    cancelVideoJob(id, nodeId, store);
  });
  const frames: Frame[] = [];

  function emit(rev: number, event: CanvasEvent): void {
    frames[frames.length - 1].events.push({ rev, event });
  }

  function dirty(canvasId: string, nodeId: string, rev: number): void {
    for (const node of store.annotatedFrom(canvasId, nodeId)) emit(rev, { type: 'node_updated', node });
  }

  function batch<T>(canvasId: string, request: unknown, fn: () => T, mutationId?: string): T {
    if (canvasWorkStopped(store)) throw new CanvasCommandError('应用正在退出，不能提交新的画布操作', 503);
    if (frames.length && frames[frames.length - 1].canvasId !== canvasId) {
      throw new CanvasCommandError('A compound command must target one canvas');
    }
    if (!store.getCanvas(canvasId)) throw new CanvasCommandError('Canvas not found', 404);
    if (mutationId !== undefined && (!mutationId.trim() || mutationId.length > 256)) {
      throw new CanvasCommandError('mutationId must contain 1 to 256 characters');
    }
    const hash = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
    const frame: Frame = { canvasId, events: [], afterCommit: [] };
    frames.push(frame);
    let result: T;
    try {
      result = store.transaction(() => {
        const receipt = mutationId ? store.getReceipt(canvasId, mutationId) : null;
        if (receipt) {
          if (receipt.requestHash !== hash) throw new CanvasCommandError('mutationId was already used for a different command', 409);
          return JSON.parse(receipt.resultJson) as T;
        }
        const value = fn();
        if (value && typeof (value as { then?: unknown }).then === 'function') {
          throw new Error('Canvas commands must be synchronous');
        }
        if (mutationId) store.saveReceipt(canvasId, mutationId, hash, value);
        return value;
      }, { canvasId, mutationId });
    } finally {
      frames.pop();
    }
    const parent = frames[frames.length - 1];
    if (parent) {
      parent.events.push(...frame.events);
      parent.afterCommit.push(...frame.afterCommit);
    } else {
      // These effects cannot roll back a committed command. A disconnected client resyncs from SQLite.
      for (const action of frame.afterCommit) {
        try { action(); } catch (err) { console.error('[canvas] after-commit action failed', err); }
      }
      for (const effect of frame.events) {
        try { publish(canvasId, effect.rev, effect.event); } catch (err) { console.error('[canvas] publish failed', err); }
      }
    }
    return result;
  }

  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new CanvasCommandError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return result.data;
  }

  return {
    batch,
    /** Read durable command results before asynchronous adapters recapture mutable source selections. */
    replay<T>(canvasId: string, request: unknown, mutationId?: string): T | null {
      if (canvasWorkStopped(store)) throw new CanvasCommandError('应用正在退出，不能提交新的画布操作', 503);
      if (!store.getCanvas(canvasId)) throw new CanvasCommandError('Canvas not found', 404);
      if (mutationId === undefined) return null;
      if (!mutationId.trim() || mutationId.length > 256) throw new CanvasCommandError('mutationId must contain 1 to 256 characters');
      const receipt = store.getReceipt(canvasId, mutationId);
      if (!receipt) return null;
      const hash = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
      if (receipt.requestHash !== hash) throw new CanvasCommandError('mutationId was already used for a different command', 409);
      return JSON.parse(receipt.resultJson) as T;
    },
    reuseAsset(canvasId: string, input: z.infer<typeof reuseInput>, mutationId?: string) {
      const checked = parse(reuseInput, input);
      return batch(canvasId, { kind: 'reuse_asset', input: checked }, () => {
        const asset = store.assets.get(checked.assetId);
        if (!asset) throw new CanvasCommandError('素材不存在，请重新选择', 404);
        if (checked.asReference && asset.kind !== 'image' && asset.kind !== 'mask') throw new CanvasCommandError('固定参考仅支持图片素材');
        const type: CanvasNodeType = checked.asReference ? 'anchor' : asset.kind === 'audio' ? 'audio' : asset.kind === 'video' ? 'video' : 'image';
        const box = defaultNodeBox(type);
        const params = type === 'anchor' ? { assetId: asset.id, role: 'content', strength: 'mid' }
          : { importedAssetId: asset.id, prompt: '', ...(type === 'image' ? { size: '1024x1024' } : {}) };
        const node = store.addNode(canvasId, { type, x: checked.x ?? 40, y: checked.y ?? 40, ...box,
          title: checked.title ?? (type === 'anchor' ? '固定参考' : type === 'audio' ? '音频素材' : type === 'video' ? '视频素材' : '图片素材'), params }).node;
        const result = store.updateNode(canvasId, node.id, { runState: 'done', output: { assets: [asset.path], activeAssetIndex: 0,
          resultSet: [{ asset: asset.path, assetId: asset.id, createdAt: asset.createdAt, jobId: asset.jobId, generation: asset.generation,
            providerId: asset.providerId, model: asset.model, inputHash: asset.inputHash }] } });
        if (!result) throw new Error('素材复用未能完成');
        emit(result.rev, { type: 'node_added', node: result.node });
        return { node: result.node, asset };
      }, mutationId);
    },
    /** Protect committed external resources before subscribers can react to the new document. */
    afterCommit(effect: () => void): void {
      const frame = frames[frames.length - 1];
      if (!frame) throw new Error('Canvas afterCommit requires an active command batch');
      frame.afterCommit.push(effect);
    },
    addNode(canvasId: string, input: NodeInput, operationId?: string) {
      return batch(canvasId, { kind: 'add_node', input }, () => {
        const result = store.addNode(canvasId, parse(nodeInput, input));
        emit(result.rev, { type: 'node_added', node: result.node, operationId });
        return result;
      }, operationId);
    },
    updateNode(canvasId: string, id: string, patch: NodePatch, operationId?: string) {
      return batch(canvasId, { kind: 'update_node', id, patch }, () => {
        const checked = parse(nodePatch, patch) as NodePatch;
        const result = store.updateNode(canvasId, id, checked);
        if (result) {
          emit(result.rev, { type: 'node_updated', node: result.node, operationId });
          if (checked.params !== undefined || checked.output !== undefined) dirty(canvasId, id, result.rev);
        }
        return result;
      }, operationId);
    },
    deleteNode(canvasId: string, id: string, operationId?: string) {
      return batch(canvasId, { kind: 'delete_node', id }, () => {
        const edges = store.getEdges(canvasId).filter((edge) => edge.sourceId === id || edge.targetId === id);
        const result = store.deleteNode(canvasId, id);
        if (result) {
          frames[frames.length - 1].afterCommit.push(() => cancelNode(canvasId, id));
          emit(result.rev, { type: 'node_deleted', id, operationId });
          for (const edge of edges) {
            emit(result.rev, { type: 'edge_deleted', id: edge.id, operationId });
            if (edge.sourceId === id) dirty(canvasId, edge.targetId, result.rev);
          }
        }
        return result;
      }, operationId);
    },
    addEdge(canvasId: string, input: EdgeInput, operationId?: string) {
      return batch(canvasId, { kind: 'add_edge', input }, () => {
        const result = store.addEdge(canvasId, parse(edgeInput, input));
        if (result.edge && result.rev !== undefined) {
          emit(result.rev, { type: 'edge_added', edge: result.edge, operationId });
          dirty(canvasId, input.targetId, result.rev);
        }
        return result;
      }, operationId);
    },
    deleteEdge(canvasId: string, id: string, operationId?: string) {
      return batch(canvasId, { kind: 'delete_edge', id }, () => {
        const result = store.deleteEdge(canvasId, id);
        if (result) {
          emit(result.rev, { type: 'edge_deleted', id, operationId });
          dirty(canvasId, result.targetId, result.rev);
        }
        return result;
      }, operationId);
    },
  };
}

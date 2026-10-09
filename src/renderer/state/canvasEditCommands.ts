import { nanoid } from 'nanoid';
import { inverseEdits, restoreNodeEdit, type CanvasEdit, type CanvasEditUpload } from '../../shared/canvasEdits';
import type { CanvasSnapshot } from '../../shared/canvas';
import type { HistoryEntry } from './canvasHistory';

interface Context { snapshot: CanvasSnapshot; accept: (snapshot: CanvasSnapshot) => void }

/** Each replay retains its receipt identity until success, including after a lost HTTP response. */
export class CanvasEditCommands {
  constructor(private context: (sessionId: string) => Context,
    private send: (canvasId: string, edits: CanvasEdit[], id: string, revision?: number) => Promise<CanvasSnapshot>,
    private record: (sessionId: string, entry: HistoryEntry) => void) {}

  private replay(sessionId: string, edits: CanvasEdit[]) {
    let pending: { id: string; canvasId: string; revision: number } | undefined;
    return async () => {
      const context = this.context(sessionId);
      pending ??= { id: nanoid(), canvasId: context.snapshot.canvas.id, revision: context.snapshot.canvas.liveRevision };
      if (context.snapshot.canvas.id !== pending.canvasId) throw new Error('画布身份已经变化');
      let result: CanvasSnapshot;
      try { result = await this.send(pending.canvasId, edits, pending.id, pending.revision); }
      catch (error) {
        // A definite rejection committed nothing. Transport errors retain the receipt for safe replay.
        const status = (error as { status?: number })?.status;
        if (status >= 400 && status < 500) pending = undefined;
        throw error;
      }
      if (this.context(sessionId).snapshot.canvas.id !== pending.canvasId) throw new Error('画布身份已经变化');
      context.accept(result);
      pending = undefined;
    };
  }

  /** Freeze one plan so a UI retry cannot create a second document operation after a lost response. */
  prepare(sessionId: string, fixedEdits: CanvasEdit[], agentTurn?: number): () => Promise<void> {
    const edits = structuredClone(fixedEdits);
    const { snapshot } = this.context(sessionId);
    const originalCanvasId = snapshot.canvas.id;
    const inverse = structuredClone(inverseEdits(edits, snapshot.nodes, snapshot.edges));
    const replay = this.replay(sessionId, edits);
    let completed = edits.length === 0;
    let inflight: Promise<void> | undefined;
    return () => {
      if (completed) return Promise.resolve();
      if (inflight) return inflight;
      // Assign the shared promise before starting transport, including synchronous subscribers.
      inflight = Promise.resolve().then(async () => {
        if (this.context(sessionId).snapshot.canvas.id !== originalCanvasId) throw new Error('画布身份已经变化');
        await replay();
        if (this.context(sessionId).snapshot.canvas.id !== originalCanvasId) throw new Error('画布身份已经变化');
        this.record(sessionId, { undo: this.replay(sessionId, inverse), redo: this.replay(sessionId, edits), agentTurn });
        completed = true;
      }).finally(() => { inflight = undefined; });
      return inflight;
    };
  }

  async commit(sessionId: string, edits: CanvasEdit[], agentTurn?: number) {
    if (!edits.length) return;
    await this.prepare(sessionId, edits, agentTurn)();
  }

  recordExisting(sessionId: string, undo: CanvasEdit[], redo: CanvasEdit[], agentTurn?: number) {
    this.record(sessionId, { undo: this.replay(sessionId, undo), redo: this.replay(sessionId, redo), agentTurn });
  }

  async commitWithResult(sessionId: string, edits: CanvasEdit[], send: () => Promise<CanvasSnapshot>, uploads: CanvasEditUpload[] = []) {
    const context = this.context(sessionId);
    // Uploads also change existing nodes outside the declared edit patch. Include those
    // fields in history so their published pixels/masks are restored without another upload.
    const historyEdits = edits.map((edit): CanvasEdit => edit.kind === 'update_node' ? { ...edit, patch: { ...edit.patch } } : edit);
    for (const upload of uploads) {
      if (historyEdits.some((edit) => edit.kind === 'add_node' && edit.id === upload.nodeId)) continue;
      let update = historyEdits.find((edit) => edit.kind === 'update_node' && edit.id === upload.nodeId);
      if (!update) { update = { kind: 'update_node', id: upload.nodeId, patch: {} }; historyEdits.push(update); }
      if (update.kind !== 'update_node') continue;
      const before = context.snapshot.nodes.find((node) => node.id === upload.nodeId);
      if (!before) throw new Error('待上传节点不存在');
      if (upload.role === 'mask') update.patch.params ??= before.params;
      else { update.patch.output = before.output; update.patch.runState = before.runState; }
    }
    const inverse = inverseEdits(historyEdits, context.snapshot.nodes, context.snapshot.edges);
    const result = await send();
    if (this.context(sessionId).snapshot.canvas.id !== context.snapshot.canvas.id) throw new Error('画布身份已经变化');
    context.accept(result);
    const redo = historyEdits.map((edit): CanvasEdit => {
      if (edit.kind !== 'add_node' && edit.kind !== 'update_node') return edit;
      const node = result.nodes.find((node) => node.id === edit.id);
      if (!node) throw new Error('提交的节点缺少权威结果');
      if (edit.kind === 'add_node') return restoreNodeEdit(node);
      return { ...edit, patch: Object.fromEntries(Object.keys(edit.patch).map((key) => [key, node[key as keyof typeof node]])) };
    });
    this.recordExisting(sessionId, inverse, redo);
    return result;
  }
}

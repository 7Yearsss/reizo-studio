import type { CanvasNode } from '../../shared/canvas';
import type { CanvasDocumentChange } from '../../shared/canvasSync';

export type CanvasEditablePatch = Partial<Pick<CanvasNode, 'x' | 'y' | 'w' | 'h' | 'params' | 'title' | 'output'>>;
type EditableKey = keyof CanvasEditablePatch;
interface PendingField { value: unknown; owner?: string; acknowledgedAt?: number }
interface PendingNode { authority: CanvasNode; fields: Map<EditableKey, PendingField> }

/** Only pending fields are overlaid; provider output and other committed fields stay authoritative. */
export class CanvasLocalEdits {
  private pending = new Map<string, PendingNode>();
  private acknowledgement = 0;

  get acknowledgedVersion(): number { return this.acknowledgement; }

  stage(node: CanvasNode, patch: CanvasEditablePatch, owner?: string): void {
    let entry = this.pending.get(node.id);
    if (!entry || entry.authority.canvasId !== node.canvasId) {
      entry = { authority: node, fields: new Map() };
      this.pending.set(node.id, entry);
    }
    for (const key of Object.keys(patch) as EditableKey[]) {
      if (patch[key] !== undefined) entry.fields.set(key, { value: patch[key], owner });
    }
  }

  receiveChanges(changes: CanvasDocumentChange[], mutationId?: string): void {
    for (const change of changes) {
      const id = change.type === 'node_added' || change.type === 'node_updated' ? change.node.id
        : change.type === 'node_deleted' || change.type === 'run_state' || change.type === 'node_output' ? change.id : undefined;
      if (id === undefined) continue;
      const entry = this.pending.get(id);
      if (!entry) continue;
      if (change.type === 'node_deleted') { this.pending.delete(id); continue; }
      if (change.type === 'node_added' || change.type === 'node_updated') entry.authority = change.node;
      if (change.type === 'run_state') entry.authority = { ...entry.authority, runState: change.runState };
      if (change.type === 'node_output') entry.authority = { ...entry.authority, runState: change.runState, output: change.output };
      if (mutationId) {
        for (const [key, field] of entry.fields) if (field.owner === mutationId) entry.fields.delete(key);
      }
      if (entry.fields.size === 0) this.pending.delete(id);
    }
  }

  receiveSnapshot(canvasId: string, nodes: CanvasNode[], acknowledgedVersion: number): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, entry] of this.pending) {
      const node = byId.get(id);
      if (entry.authority.canvasId !== canvasId || !node) { this.pending.delete(id); continue; }
      entry.authority = node;
      for (const [key, field] of entry.fields) {
        if (field.acknowledgedAt !== undefined && field.acknowledgedAt <= acknowledgedVersion) entry.fields.delete(key);
      }
      if (entry.fields.size === 0) this.pending.delete(id);
    }
  }

  confirmAcknowledgements(acknowledgedVersion: number): Map<string, CanvasNode> {
    const restored = new Map<string, CanvasNode>();
    for (const [id, entry] of this.pending) {
      let changed = false;
      for (const [key, field] of entry.fields) {
        if (field.acknowledgedAt !== undefined && field.acknowledgedAt <= acknowledgedVersion) {
          entry.fields.delete(key);
          changed = true;
        }
      }
      if (changed) restored.set(id, this.finish(id, entry));
    }
    return restored;
  }

  project(nodes: CanvasNode[]): CanvasNode[] {
    let projected = nodes;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const entry = this.pending.get(node.id);
      if (!entry || entry.authority.canvasId !== node.canvasId) continue;
      const patch = Object.fromEntries([...entry.fields].map(([key, field]) => [key, field.value]));
      if ([...entry.fields].every(([key, field]) => node[key] === field.value)) continue;
      if (projected === nodes) projected = [...nodes];
      projected[index] = { ...node, ...patch };
    }
    return projected;
  }

  acknowledge(id: string, canvasId: string, owner: string, response: CanvasNode, awaitCommit: boolean): CanvasNode | undefined {
    const entry = this.pending.get(id);
    if (!entry || entry.authority.canvasId !== canvasId) return;
    const acknowledgedAt = ++this.acknowledgement;
    let changed = false;
    const accepted: Record<string, unknown> = {};
    for (const [key, field] of entry.fields) {
      if (field.owner !== owner) continue;
      field.acknowledgedAt = acknowledgedAt;
      if (!awaitCommit) {
        accepted[key] = response[key];
        entry.fields.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    entry.authority = { ...entry.authority, ...accepted };
    return this.finish(id, entry);
  }

  hasOwner(id: string, owner: string): boolean {
    return [...(this.pending.get(id)?.fields.values() ?? [])].some((field) => field.owner === owner);
  }

  fail(id: string, canvasId: string, owner: string): CanvasNode | undefined {
    const entry = this.pending.get(id);
    if (!entry || entry.authority.canvasId !== canvasId) return;
    let changed = false;
    for (const [key, field] of entry.fields) {
      if (field.owner === owner) { entry.fields.delete(key); changed = true; }
    }
    return changed ? this.finish(id, entry) : undefined;
  }

  discardLive(id: string, keys: EditableKey[] = ['x', 'y', 'w', 'h']): CanvasNode | undefined {
    const entry = this.pending.get(id);
    if (!entry) return;
    let changed = false;
    for (const key of keys) {
      if (entry.fields.has(key) && entry.fields.get(key)?.owner === undefined) {
        entry.fields.delete(key);
        changed = true;
      }
    }
    return changed ? this.finish(id, entry) : undefined;
  }

  discardAllLive(): Map<string, CanvasNode> {
    const restored = new Map<string, CanvasNode>();
    for (const id of [...this.pending.keys()]) {
      const node = this.discardLive(id);
      if (node) restored.set(id, node);
    }
    return restored;
  }

  remove(id: string): void { this.pending.delete(id); }

  private finish(id: string, entry: PendingNode): CanvasNode {
    const node = { ...entry.authority, ...Object.fromEntries([...entry.fields].map(([key, field]) => [key, field.value])) };
    if (entry.fields.size === 0) this.pending.delete(id);
    return node;
  }
}

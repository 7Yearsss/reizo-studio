import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { nanoid } from 'nanoid';
import type { CanvasNode, CanvasNodeParams } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { canvasAssetsDir } from './imageExecutor';
import { WORKFLOW_VERSION } from './exportWorkflow';

export interface ImportResult {
  nodeIds: string[];
  edgeIds: string[];
  warnings: string[];
}

/** `@#<id[:8]>` mention rewrite so cross-file references survive re-id-ing. */
function remapMentions(text: string, old8ToNew8: Map<string, string>): string {
  return text.replace(/@#([A-Za-z0-9_-]{1,8})/g, (whole, prefix: string) => {
    const next = old8ToNew8.get(prefix);
    return next ? `@#${next}` : whole;
  });
}

/**
 * Restore a `.reizo.zip` into an existing canvas, appending its nodes / edges
 * with fresh ids (so it never collides with what is already there). Asset
 * bytes are written into the target canvas's asset dir; `memberIds` and
 * `@#id` prompt references are remapped to the new ids.
 *
 * Validates the manifest before touching disk. On a mid-write failure it
 * best-effort removes whatever it already created.
 */
export async function importWorkflowZip(options: {
  canvasStore: CanvasStore;
  dataRoot: string;
  canvasId: string;
  zip: Uint8Array;
  offset?: { x: number; y: number };
}): Promise<ImportResult> {
  const { canvasStore, dataRoot, canvasId, zip } = options;
  const offset = options.offset ?? { x: 48, y: 48 };
  if (!canvasStore.getCanvas(canvasId)) throw new Error('canvas not found');

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error('压缩包损坏或不是有效的 .zip');
  }

  const manifestRaw = entries['workflow.json'];
  if (!manifestRaw) throw new Error('缺少 workflow.json');
  let manifest: {
    version?: number;
    nodes?: CanvasNode[];
    edges?: Array<{ sourceId: string; targetId: string; sourceHandle?: string | null; targetHandle?: string | null }>;
    warnings?: string[];
  };
  try {
    manifest = JSON.parse(strFromU8(manifestRaw));
  } catch {
    throw new Error('workflow.json 解析失败');
  }
  if (manifest.version !== WORKFLOW_VERSION) {
    throw new Error(`工程版本不兼容（期望 ${WORKFLOW_VERSION}，实际 ${manifest.version ?? '未知'}）`);
  }

  const srcNodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
  const srcEdges = Array.isArray(manifest.edges) ? manifest.edges : [];
  const warnings: string[] = Array.isArray(manifest.warnings) ? [...manifest.warnings] : [];

  const channel = getCanvasChannel(canvasId);
  const dir = canvasAssetsDir(dataRoot, canvasId);
  await mkdir(dir, { recursive: true });

  const writtenFiles: string[] = [];
  const createdNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];

  const rollback = async () => {
    for (const id of createdNodeIds) {
      const res = canvasStore.deleteNode(canvasId, id);
      if (res) channel.broadcast(res.rev, { type: 'node_deleted', id });
    }
    for (const abs of writtenFiles) await unlink(abs).catch((): undefined => undefined);
  };

  try {
    // 1. Unpack assets into the target canvas dir; map zip path -> new rel path.
    const assetRemap = new Map<string, string>();
    for (const [name, bytes] of Object.entries(entries)) {
      if (name === 'workflow.json') continue;
      if (!name.startsWith('assets/') || name.includes('..') || path.isAbsolute(name)) {
        warnings.push(`跳过非法条目 ${name}`);
        continue;
      }
      const ext = name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin';
      const file = `wf-${nanoid(10)}.${ext}`;
      const abs = path.join(dir, file);
      await writeFile(abs, Buffer.from(bytes));
      writtenFiles.push(abs);
      assetRemap.set(name, `${canvasId}/${file}`);
    }

    // 2. Recreate nodes (raw params first) so every id exists before remapping.
    const idMap = new Map<string, string>();
    const old8ToNew8 = new Map<string, string>();
    for (const n of srcNodes) {
      const { rev, node } = canvasStore.addNode(canvasId, {
        type: n.type,
        x: Math.round((n.x ?? 0) + offset.x),
        y: Math.round((n.y ?? 0) + offset.y),
        w: n.w ?? 320,
        h: n.h ?? 240,
        title: n.title ?? '',
        params: (n.params ?? {}) as CanvasNodeParams,
      });
      idMap.set(n.id, node.id);
      old8ToNew8.set(n.id.slice(0, 8), node.id.slice(0, 8));
      createdNodeIds.push(node.id);
      channel.broadcast(rev, { type: 'node_added', node });
    }

    // 3. Second pass: remap params (memberIds / @#id), restore outputs.
    for (const n of srcNodes) {
      const newId = idMap.get(n.id);
      if (!newId) continue;
      const params: Record<string, unknown> = { ...((n.params ?? {}) as Record<string, unknown>) };
      if (n.type === 'group' && Array.isArray(params.memberIds)) {
        params.memberIds = (params.memberIds as string[])
          .map((mid) => idMap.get(mid))
          .filter((mid): mid is string => Boolean(mid));
      }
      if (typeof params.prompt === 'string') {
        params.prompt = remapMentions(params.prompt, old8ToNew8);
      }
      const mappedAssets = (n.output?.assets ?? [])
        .map((a) => assetRemap.get(a))
        .filter((a): a is string => Boolean(a));
      const output =
        n.output && (mappedAssets.length > 0 || n.output.text)
          ? { ...n.output, assets: mappedAssets }
          : null;
      const runState = output && (mappedAssets.length > 0 || output.text) ? 'done' : 'idle';
      const res = canvasStore.updateNode(canvasId, newId, {
        params: params as CanvasNodeParams,
        output,
        runState,
      });
      if (res) channel.broadcast(res.rev, { type: 'node_updated', node: res.node });
    }

    // 4. Edges.
    for (const e of srcEdges) {
      const s = idMap.get(e.sourceId);
      const t = idMap.get(e.targetId);
      if (!s || !t) continue;
      const res = canvasStore.addEdge(canvasId, {
        sourceId: s,
        targetId: t,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      });
      if (res.edge && res.rev !== undefined) {
        createdEdgeIds.push(res.edge.id);
        channel.broadcast(res.rev, { type: 'edge_added', edge: res.edge });
      }
    }

    return { nodeIds: createdNodeIds, edgeIds: createdEdgeIds, warnings };
  } catch (err) {
    await rollback();
    throw err instanceof Error ? err : new Error('导入失败');
  }
}

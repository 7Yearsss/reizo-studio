import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { nanoid } from 'nanoid';
import type { CanvasNode, CanvasNodeOutput, CanvasNodeParams } from '../../../shared/canvas';
import type { CanvasAsset } from '../../../shared/canvasAssets';
import type { CanvasStore } from '../storage/canvasStore';
import { stageCanvasAssets, type CanvasAssetFileInput } from './assets';
import { canvasWorkSignal } from './workLifecycle';
import { WORKFLOW_VERSION } from './exportWorkflow';
import { createCanvasApplication } from './application';

export interface ImportResult { nodeIds: string[]; edgeIds: string[]; warnings: string[] }
const MIMES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac' };

function remapMentions(text: string, ids: Map<string, string>): string {
  const short = new Map([...ids].map(([old, next]) => [old.slice(0, 8), next.slice(0, 8)]));
  return text.replace(/@#([A-Za-z0-9_-]{1,8})/g, (whole, id: string) => short.has(id) ? '@#' + short.get(id) : whole)
    .replace(/\]\(canvas:([^)]+)\)/g, (whole, id: string) => ids.has(id) ? '](canvas:' + ids.get(id) + ')' : whole);
}

/** Files stage first; document and asset identities publish together in one command. */
export async function importWorkflowZip(options: {
  canvasStore: CanvasStore; dataRoot: string; canvasId: string; zip: Uint8Array;
  offset?: { x: number; y: number }; operationId?: string;
}): Promise<ImportResult> {
  const { canvasStore: store, dataRoot, canvasId, zip } = options;
  const app = createCanvasApplication(store);
  const offset = options.offset ?? { x: 48, y: 48 };
  if (!store.getCanvas(canvasId)) throw new Error('canvas not found');
  let entries: Record<string, Uint8Array>;
  try {
    let total = 0; let count = 0;
    entries = unzipSync(zip, { filter: (file) => {
      total += file.originalSize;
      if (++count > 10_000 || total > 256 * 1024 * 1024) throw new Error('Workflow archive exceeds extraction limits');
      return true;
    } });
  } catch { throw new Error('压缩包损坏、过大或不是有效的 .zip'); }
  const raw = entries['workflow.json'];
  if (!raw) throw new Error('缺少 workflow.json');
  let manifest: { version?: number; nodes?: CanvasNode[]; edges?: Array<{ sourceId: string; targetId: string; sourceHandle?: string | null; targetHandle?: string | null }>; warnings?: string[] };
  try { manifest = JSON.parse(strFromU8(raw)); } catch { throw new Error('workflow.json 解析失败'); }
  if (manifest.version !== WORKFLOW_VERSION) throw new Error('工程版本不兼容（期望 ' + WORKFLOW_VERSION + '，实际 ' + (manifest.version ?? '未知') + '）');
  const nodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
  const edges = Array.isArray(manifest.edges) ? manifest.edges : [];
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings.filter((item): item is string => typeof item === 'string') : [];
  const maskRefs = new Set(nodes.map((node) => (node.params as { edit?: { maskAsset?: string } })?.edit?.maskAsset).filter(Boolean));
  const members: string[] = [];
  const files: CanvasAssetFileInput[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === 'workflow.json') continue;
    if (!name.startsWith('assets/') || name.includes('..') || name.includes('\\') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || !bytes.byteLength) {
      warnings.push('跳过非法或空条目 ' + name); continue;
    }
    const ext = name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const mimeType = MIMES[ext] || 'application/octet-stream';
    members.push(name);
    files.push({ name: 'wf-' + nanoid(10) + '.' + ext, bytes, mimeType,
      kind: maskRefs.has(name) ? 'mask' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'image' });
  }
  const staged = await stageCanvasAssets(dataRoot, canvasId, files, canvasWorkSignal(store));
  try {
    return app.batch(canvasId, { kind: 'import_workflow', contentHash: createHash('sha256').update(zip).digest('hex'), offset }, () => {
      const ids = new Map<string, string>();
      const nodeIds: string[] = []; const edgeIds: string[] = [];
      for (const node of nodes) {
        if (!node.id || ids.has(node.id)) throw new Error('工作流包含无效或重复节点 ID');
        const added = app.addNode(canvasId, { type: node.type, x: Math.round((node.x ?? 0) + offset.x), y: Math.round((node.y ?? 0) + offset.y),
          w: node.w ?? 320, h: node.h ?? 240, title: node.title ?? '', params: node.params ?? {} }).node;
        ids.set(node.id, added.id); nodeIds.push(added.id);
      }
      const assets = new Map<string, CanvasAsset>();
      staged.files.forEach((file, index) => assets.set(members[index], store.assets.register({ ...file, canvasId, source: 'imported' })));
      for (const node of nodes) {
        const id = ids.get(node.id);
        const params: Record<string, unknown> = { ...(node.params ?? {}) };
        for (const key of ['memberIds', 'refNodeIds']) if (Array.isArray(params[key])) params[key] = (params[key] as string[]).map((old) => ids.get(old)).filter(Boolean);
        for (const key of ['prompt', 'content']) if (typeof params[key] === 'string') params[key] = remapMentions(params[key] as string, ids);
        if (params.edit && typeof params.edit === 'object') {
          const edit = { ...params.edit } as Record<string, unknown>;
          if (typeof edit.sourceNodeId === 'string') edit.sourceNodeId = ids.get(edit.sourceNodeId) ?? 'missing-import-' + nanoid();
          if (typeof edit.maskAsset === 'string') {
            const mask = assets.get(edit.maskAsset);
            if (mask) edit.maskAsset = mask.path;
            else { warnings.push('缺少蒙版 ' + edit.maskAsset); delete edit.maskAsset; }
          }
          params.edit = edit;
        }
        const oldOutput = node.output;
        let fixedAsset: CanvasAsset | undefined;
        if (node.type === 'anchor' && (params.assetId !== undefined || params.assetRef !== undefined)) {
          // Older v1 archives carried a local assetId. Restore the archived
          // selected file instead of accidentally linking an existing local ID.
          const ref = params.assetRef !== undefined ? params.assetRef : oldOutput?.assets?.[oldOutput.activeAssetIndex ?? 0] ?? oldOutput?.assets?.[0];
          fixedAsset = typeof ref === 'string' ? assets.get(ref) : undefined;
          if (!fixedAsset || (fixedAsset.kind !== 'image' && fixedAsset.kind !== 'mask')) throw new Error('工作流缺少固定参考资源');
          params.assetId = fixedAsset.id;
          delete params.assetRef;
        }
        if (params.importedAssetId !== undefined && (node.type === 'image' || node.type === 'video' || node.type === 'audio')) {
          const imported = assets.get(oldOutput?.assets?.[oldOutput.activeAssetIndex ?? 0] ?? oldOutput?.assets?.[0]);
          if (imported) params.importedAssetId = imported.id;
          else delete params.importedAssetId;
        }
        let output: CanvasNodeOutput | null = null;
        const paths = (oldOutput?.assets ?? []).map((old) => assets.get(old)?.path).filter((item): item is string => Boolean(item));
        if (oldOutput && (paths.length || oldOutput.text)) {
          const selected = assets.get(oldOutput.assets?.[oldOutput.activeAssetIndex ?? 0])?.path;
          const selectedIndex = selected ? paths.indexOf(selected) : 0;
          output = { ...oldOutput, assets: paths, activeAssetIndex: Math.max(0, selectedIndex),
            resultSet: (oldOutput.resultSet ?? []).flatMap((version) => {
              const asset = assets.get(version.asset);
              if (!asset) return [];
              const display = { ...version };
              for (const key of ['jobId', 'generation', 'providerId', 'inputHash', 'assetId'] as const) delete display[key];
              return [{ ...display, asset: asset.path, assetId: asset.id }];
            }) };
          delete output.progress; delete output.error;
        }
        if (fixedAsset) output = { assets: [fixedAsset.path], activeAssetIndex: 0,
          resultSet: [{ asset: fixedAsset.path, assetId: fixedAsset.id, createdAt: fixedAsset.createdAt }] };
        app.updateNode(canvasId, id, { params: params as CanvasNodeParams, output, runState: output ? 'done' : 'idle', paramsHash: null });
      }
      for (const edge of edges) {
        const sourceId = ids.get(edge.sourceId); const targetId = ids.get(edge.targetId);
        if (!sourceId || !targetId) { warnings.push('跳过缺少端点的连线'); continue; }
        const added = app.addEdge(canvasId, { sourceId, targetId, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null });
        if (!added.edge) throw new Error(added.error || '工作流连线无效');
        edgeIds.push(added.edge.id);
      }
      app.afterCommit(() => staged.keep());
      return { nodeIds, edgeIds, warnings };
    }, options.operationId);
  } finally { await staged.discard(); }
}

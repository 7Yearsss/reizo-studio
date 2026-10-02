import type { AnchorRole, AnchorStrength, CanvasNode, CanvasVideoParams } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { CanvasJobStoreError } from '../storage/canvasJobStore';
import { readCanvasAsset } from './assets';
import { replayVideoJob, startVideoJob, type VideoJobSubmission } from './asyncJobManager';
import { resolveMentions } from '../../../shared/resolveMentions';
import { planAnchors } from '../../../shared/referenceAnchors';
import { captureReferenceNodes, selectedAsset } from '../../../shared/canvasReferences';
import { cameraFromPreset, cameraToPrompt, normalizeCamera } from '../../../shared/cameraMotion';
import type { VideoGenerateParams } from './videoDrivers';
import { canvasWorkStopped } from './workLifecycle';
import { inputHash } from './graph';

export { replayVideoJob } from './asyncJobManager';
export interface VideoNodeOptions {
  canvasStore: CanvasStore; settingsStore: SettingsStore; dataRoot: string; canvasId: string; node: CanvasNode;
  providerId?: string; operationId?: string; signal?: AbortSignal; waitForCompletion?: boolean;
}
interface Reference { asset: string; type: string; targetHandle: string | null; role?: string }

/** Admit a frozen canvas request before provider work. No credentials or binary payloads enter the ledger. */
export function startVideoNode(options: VideoNodeOptions): VideoJobSubmission {
  const { canvasStore: store, canvasId, providerId, operationId } = options;
  const replay = replayVideoJob(store, canvasId, options.node.id, operationId, providerId);
  if (replay) return replay;
  const snapshot = store.getSnapshot(canvasId);
  const node = snapshot?.nodes.find((candidate) => candidate.id === options.node.id);
  if (!node) throw new CanvasJobStoreError('Canvas video node not found', 404);
  if (node.type !== 'video') throw new CanvasJobStoreError('A video job requires a video node');
  const params = node.params as CanvasVideoParams;
  const incoming = snapshot.edges.filter((edge) => edge.targetId === node.id);
  let captured: ReturnType<typeof captureReferenceNodes>;
  try {
    captured = captureReferenceNodes(incoming.map((edge) => snapshot.nodes.find((candidate) => candidate.id === edge.sourceId))
      .filter((candidate): candidate is CanvasNode => Boolean(candidate)), (id) => store.assets.get(id));
  } catch (error) {
    throw new CanvasJobStoreError(error instanceof Error ? error.message : String(error));
  }
  const upstream = captured.nodes;
  let prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
  if (!prompt) {
    for (const candidate of upstream) {
      const text = candidate.type === 'note' ? (candidate.params as { content?: string }).content : candidate.type === 'agent' ? candidate.output?.text : undefined;
      if (text?.trim()) { prompt = text.trim(); break; }
    }
  }
  if (!prompt) throw new CanvasJobStoreError('Video node has no prompt (缺少提示词，请在卡片中填写或连入上游便签/Agent)');
  const wired: Reference[] = [];
  for (const edge of incoming) {
    const candidate = upstream.find((item) => item.id === edge.sourceId);
    const asset = candidate ? selectedAsset(candidate) : undefined;
    if (asset) wired.push({ asset, type: candidate.type, targetHandle: edge.targetHandle, role: (candidate.params as { role?: string }).role });
  }
  const anchors = upstream.filter((candidate) => candidate.type === 'anchor');
  let anchorRefs: string[] = [];
  if (anchors.length) {
    const { promptPrefix, orderedAssetRefs } = planAnchors(anchors.map((anchor) => {
      const values = anchor.params as { role?: AnchorRole; strength?: AnchorStrength; note?: string };
      return { id: anchor.id, role: values.role ?? 'character', strength: values.strength ?? 'mid', note: values.note, title: anchor.title, assets: selectedAsset(anchor) ? [selectedAsset(anchor)] : [] };
    }));
    anchorRefs = orderedAssetRefs;
    if (promptPrefix) prompt = `${promptPrefix}\n${prompt}`;
  }
  let mentionRefs: string[] = [];
  if (prompt.includes('@')) {
    const resolved = resolveMentions(prompt, snapshot.nodes.filter((candidate) => candidate.id !== node.id && candidate.type !== 'anchor').map((candidate) => ({
      id: candidate.id, label: candidate.title, assets: selectedAsset(candidate) ? [selectedAsset(candidate)] : [],
      text: candidate.type === 'note' ? (candidate.params as { content?: string }).content : candidate.type === 'agent' ? candidate.output?.text : undefined,
    })), anchorRefs.length + 1);
    prompt = resolved.resolvedPrompt;
    mentionRefs = resolved.orderedAssetRefs;
  }
  const numbered = [...anchorRefs, ...mentionRefs];
  const references: Reference[] = [
    ...wired.filter((reference) => reference.targetHandle !== 'reference' && reference.type !== 'anchor'),
    ...numbered.map((asset) => ({ asset, type: 'reference', targetHandle: 'reference', role: wired.find((reference) => reference.asset === asset)?.role })),
    ...wired.filter((reference) => (reference.targetHandle === 'reference' || reference.type === 'anchor') && !numbered.includes(reference.asset)),
  ];
  const camera = normalizeCamera(params.camera ?? cameraFromPreset(params.cameraMotion));
  const hint = cameraToPrompt(camera);
  const prepared: VideoGenerateParams = { prompt: hint ? `${prompt}\n${hint}` : prompt, duration: params.duration || '5s', ratio: params.ratio || '16:9', model: params.model, cameraMotion: params.cameraMotion || 'none', camera };
  const driverId = params.provider || providerId || 'mock';
  const input = JSON.parse(JSON.stringify({ request: { providerId }, driverId, node, params: prepared, references,
    requiredAssetPaths: captured.requiredAssetPaths })) as Record<string, unknown>;
  return startVideoJob({ ...options, nodeId: node.id, driverId, input, inputHash: inputHash(node, upstream),
    loadParams: async (signal) => {
      const saved = input.params as unknown as VideoGenerateParams;
      const generated: VideoGenerateParams = { ...saved };
      const refs: Array<{ bytes: Uint8Array; role?: string }> = [];
      for (const reference of input.references as Reference[]) {
        if (signal?.aborted) throw new Error('Video preparation stopped');
        try {
          const bytes = new Uint8Array(await readCanvasAsset(options.dataRoot, reference.asset));
          if (signal?.aborted) throw new Error('Video preparation stopped');
          if (reference.targetHandle === 'end_frame') generated.endImageBytes = bytes;
          else if (reference.targetHandle === 'start_frame') generated.startImageBytes = bytes;
          else if (reference.targetHandle === 'reference' || reference.type === 'anchor') refs.push({ bytes, role: reference.role });
          else if (!generated.startImageBytes && (reference.type === 'image' || reference.type === 'frameExtractor')) generated.startImageBytes = bytes;
          else if (!generated.endImageBytes && (reference.type === 'image' || reference.type === 'frameExtractor')) generated.endImageBytes = bytes;
        } catch (error) {
          if (signal?.aborted) throw error;
          if ((input.requiredAssetPaths as string[]).includes(reference.asset)) throw new Error(`固定参考图无法读取：${reference.asset}`, { cause: error });
        }
      }
      if (refs.length) { generated.referenceImages = refs; generated.startImageBytes ??= refs[0].bytes; }
      return generated;
    },
  });
}

export async function runVideoNode(options: VideoNodeOptions): Promise<void> {
  if (canvasWorkStopped(options.canvasStore)) return;
  const admission = startVideoNode(options);
  await (options.waitForCompletion === false ? admission.submitted : admission.completion);
}

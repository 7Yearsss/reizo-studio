import type { AnchorRole, AnchorStrength, CanvasNode, CanvasVideoParams } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import type { SettingsStore } from '../storage/settingsStore';
import { readCanvasAsset } from './imageExecutor';
import { awaitVideoJob, submitVideoJob } from './asyncJobManager';
import { resolveMentions } from '../../../shared/resolveMentions';
import { planAnchors } from '../../../shared/referenceAnchors';
import { cameraFromPreset, cameraToPrompt, normalizeCamera } from '../../../shared/cameraMotion';
import type { VideoGenerateParams } from './videoDrivers';

function isVideoParams(value: unknown): value is CanvasVideoParams {
  return Boolean(value && typeof value === 'object' && typeof (value as CanvasVideoParams).prompt === 'string');
}

export async function runVideoNode(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
  waitForCompletion?: boolean;
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, node, providerId } = options;

  const params = (node.params || {}) as CanvasVideoParams;
  let promptText = (typeof params.prompt === 'string' ? params.prompt : '').trim();

  if (!promptText) {
    const upstream = canvasStore.upstreamNodes(canvasId, node.id);
    for (const u of upstream) {
      if (u.type === 'note') {
        const np = u.params as { content?: string } | undefined;
        if (np?.content?.trim()) {
          promptText = np.content.trim();
          break;
        }
      } else if (u.type === 'agent') {
        const ap = u.output as { text?: string } | undefined;
        if (ap?.text?.trim()) {
          promptText = ap.text.trim();
          break;
        }
      }
    }
  }

  if (!promptText) {
    throw new Error('Video node has no prompt (缺少提示词，请在卡片中填写或连入上游便签/Agent)');
  }

  // Extract upstream images for start / end frame interpolation and reference conditioning
  const snap = canvasStore.getSnapshot(canvasId);
  const incomingEdges = snap ? snap.edges.filter((e) => e.targetId === node.id) : [];

  let startImageBytes: Uint8Array | undefined;
  let endImageBytes: Uint8Array | undefined;
  const referenceImages: Array<{ bytes: Uint8Array; role?: string }> = [];

  for (const edge of incomingEdges) {
    const up = canvasStore.getNode(canvasId, edge.sourceId);
    if (!up) continue;
    const rel = up.output?.assets?.[0];
    if (!rel) continue;
    try {
      const buf = await readCanvasAsset(dataRoot, rel);
      const bytes = new Uint8Array(buf);
      if (edge.targetHandle === 'end_frame') {
        endImageBytes = bytes;
      } else if (edge.targetHandle === 'start_frame') {
        startImageBytes = bytes;
      } else if (edge.targetHandle === 'reference' || up.type === 'anchor') {
        const role = (up.params as { role?: string })?.role;
        referenceImages.push({ bytes, role });
      } else if (!startImageBytes && (up.type === 'image' || up.type === 'frameExtractor')) {
        startImageBytes = bytes;
      } else if (!endImageBytes && (up.type === 'image' || up.type === 'frameExtractor')) {
        endImageBytes = bytes;
      }
    } catch {
      /* ignore unreadable asset */
    }
  }

  // If no explicit start_frame was given, but reference image(s) exist, route the reference image
  // as startImageBytes for drivers that require a base image
  if (!startImageBytes && referenceImages.length > 0) {
    startImageBytes = referenceImages[0].bytes;
  }

  // Reference anchors shape both prompt text and model multimodal reference slots
  const anchorNodes = incomingEdges
    .map((e) => canvasStore.getNode(canvasId, e.sourceId))
    .filter((u): u is NonNullable<typeof u> => !!u && u.type === 'anchor');
  if (anchorNodes.length > 0) {
    const { promptPrefix } = planAnchors(
      anchorNodes.map((a) => {
        const ap = a.params as { role?: AnchorRole; strength?: AnchorStrength; note?: string };
        return {
          id: a.id,
          role: ap.role ?? 'character',
          strength: ap.strength ?? 'mid',
          note: ap.note,
          title: a.title || '',
          assets: a.output?.assets ?? [],
        };
      }),
    );
    if (promptPrefix) promptText = `${promptPrefix}\n${promptText}`;
  }

  if (promptText.includes('@')) {
    // Resolve @-mentions against the whole canvas by id, not just wired-in nodes.
    const candidates = (canvasStore.getSnapshot(canvasId)?.nodes ?? [])
      .filter((u) => u.id !== node.id && u.type !== 'anchor')
      .map((u) => {
        let text: string | undefined;
        if (u.type === 'note') {
          text = (u.params as { content?: string } | undefined)?.content;
        } else if (u.type === 'agent') {
          text = (u.output as { text?: string } | undefined)?.text;
        }
        return {
          id: u.id,
          label: u.title || '',
          assets: u.output?.assets ?? [],
          text,
        };
      });
    const { resolvedPrompt } = resolveMentions(promptText, candidates);
    promptText = resolvedPrompt;
  }

  // `camera` is authoritative; a node that only has the legacy `cameraMotion`
  // preset is lifted into the structured form. The natural-language suffix is
  // appended for every driver (kling also gets a structured `camera_control`).
  const camera = normalizeCamera(params.camera ?? cameraFromPreset(params.cameraMotion));
  const cameraHint = cameraToPrompt(camera);
  const generateParams: VideoGenerateParams = {
    prompt: cameraHint ? `${promptText}\n${cameraHint}` : promptText,
    duration: params.duration || '5s',
    ratio: params.ratio || '16:9',
    cameraMotion: params.cameraMotion || 'none',
    camera,
    startImageBytes,
    endImageBytes,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
  };

  const driverId = params.provider || providerId || 'mock';

  await submitVideoJob({
    canvasStore,
    settingsStore,
    dataRoot,
    canvasId,
    nodeId: node.id,
    driverId,
    params: generateParams,
    providerId,
  });

  if (options.waitForCompletion !== false) {
    await awaitVideoJob(canvasId, node.id);
  }
}

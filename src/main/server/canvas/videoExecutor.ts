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

  if (!isVideoParams(node.params) || !node.params.prompt.trim()) {
    throw new Error('Video node has no prompt');
  }
  const params = node.params;

  // Extract upstream images for start / end frame interpolation (handle-aware)
  const snap = canvasStore.getSnapshot(canvasId);
  const incomingEdges = snap ? snap.edges.filter((e) => e.targetId === node.id) : [];

  let startImageBytes: Uint8Array | undefined;
  let endImageBytes: Uint8Array | undefined;

  for (const edge of incomingEdges) {
    const up = canvasStore.getNode(canvasId, edge.sourceId);
    if (!up || (up.type !== 'image' && up.type !== 'frameExtractor')) continue;
    const rel = up.output?.assets?.[0];
    if (!rel) continue;
    try {
      const buf = await readCanvasAsset(dataRoot, rel);
      const bytes = new Uint8Array(buf);
      if (edge.targetHandle === 'end_frame') {
        endImageBytes = bytes;
      } else if (edge.targetHandle === 'start_frame') {
        startImageBytes = bytes;
      } else if (!startImageBytes) {
        startImageBytes = bytes;
      } else if (!endImageBytes) {
        endImageBytes = bytes;
      }
    } catch {
      /* ignore unreadable asset */
    }
  }

  let promptText = params.prompt;

  // Reference anchors on a video node only shape the prompt text — the driver's
  // image slots are reserved for start/end frames (documented degrade).
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
      .map((u) => ({
        id: u.id,
        label: u.title || '',
        assets: u.output?.assets ?? [],
      }));
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

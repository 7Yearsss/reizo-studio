import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage } from 'ai';
import type { AnchorRole, AnchorStrength, CanvasImageParams, CanvasNode } from '../../../shared/canvas';
import { getProviderPreset } from '../../../shared/providers';
import { createOpenAiProvider } from '../agent/provider/openai';
import type { SettingsStore } from '../storage/settingsStore';
import type { CanvasStore } from '../storage/canvasStore';
import { getCanvasChannel } from './channel';
import { inputHash } from './graph';
import { classifyMediaError } from './mediaError';
import { resolveMentions } from '../../../shared/resolveMentions';
import { planAnchors } from '../../../shared/referenceAnchors';

/**
 * Cap on reference images sent to the model (anchors + @mentions + img2img
 * fallback combined). Most providers reject or ignore more than a handful;
 * Leonardo tops out at 6, we stay conservative.
 */
const MAX_REFERENCE_IMAGES = 4;

/**
 * Re-broadcast a node and its descendants (annotated) so their `dirty` badge
 * reflects the just-changed inputs. Rides the `rev` of the mutation that
 * triggered it — several envelopes may share a rev. `skipSelf` leaves the
 * origin node alone (used after a param PATCH that already broadcast it).
 */
export function broadcastDownstreamDirty(
  canvasStore: CanvasStore,
  canvasId: string,
  nodeId: string,
  rev: number,
  skipSelf = true,
): void {
  const channel = getCanvasChannel(canvasId);
  for (const node of canvasStore.annotatedFrom(canvasId, nodeId)) {
    if (skipSelf && node.id === nodeId) continue;
    channel.broadcast(rev, { type: 'node_updated', node });
  }
}

/** Where a canvas node's generated assets live on disk. */
export function canvasAssetsDir(dataRoot: string, canvasId: string): string {
  return path.join(dataRoot, 'canvas', canvasId);
}

function assetAbsPath(dataRoot: string, relPath: string): string {
  // relPath is `<canvasId>/<file>`; keep it inside the canvas dir.
  const abs = path.resolve(dataRoot, 'canvas', relPath);
  if (!abs.startsWith(path.resolve(dataRoot, 'canvas') + path.sep)) {
    throw new Error('asset path escapes canvas dir');
  }
  return abs;
}

export async function readCanvasAsset(dataRoot: string, relPath: string): Promise<Buffer> {
  return readFile(assetAbsPath(dataRoot, relPath));
}

function isImageParams(value: unknown): value is CanvasImageParams {
  return Boolean(value && typeof value === 'object' && typeof (value as CanvasImageParams).prompt === 'string');
}

async function upstreamImageBytes(
  store: CanvasStore,
  dataRoot: string,
  canvasId: string,
  nodeId: string,
): Promise<Uint8Array[]> {
  const upstream = store.upstreamNodes(canvasId, nodeId);
  const out: Uint8Array[] = [];
  for (const node of upstream) {
    const assets = node.output?.assets ?? [];
    for (const rel of assets.slice(0, 2)) {
      try {
        out.push(new Uint8Array(await readCanvasAsset(dataRoot, rel)));
      } catch {
        /* skip a missing asset */
      }
    }
  }
  return out.slice(0, 2);
}

/**
 * Run one image node: resolve the OpenAI-compatible provider from settings,
 * call `generateImage` (img2img when an upstream image node is wired in),
 * write the PNG(s) under `<dataRoot>/canvas/<canvasId>/`, and broadcast the
 * run-state / output transitions on the canvas channel.
 *
 * Fire-and-forget: the route returns before this resolves.
 */
export async function runImageNode(options: {
  canvasStore: CanvasStore;
  settingsStore: SettingsStore;
  dataRoot: string;
  canvasId: string;
  node: CanvasNode;
  providerId?: string;
}): Promise<void> {
  const { canvasStore, settingsStore, dataRoot, canvasId, node } = options;
  const channel = getCanvasChannel(canvasId);

  const running = canvasStore.updateNode(canvasId, node.id, { runState: 'running', output: null });
  if (running) channel.broadcast(running.rev, { type: 'run_state', id: node.id, runState: 'running' });

  const fail = (message: string) => {
    const res = canvasStore.updateNode(canvasId, node.id, {
      runState: 'error',
      output: { error: message },
    });
    if (res) {
      channel.broadcast(res.rev, {
        type: 'node_output',
        id: node.id,
        output: res.node.output ?? { error: message },
        runState: 'error',
      });
      broadcastDownstreamDirty(canvasStore, canvasId, node.id, res.rev);
    }
  };

  try {
    if (!isImageParams(node.params) || !node.params.prompt.trim()) {
      fail('Image node has no prompt');
      return;
    }
    const params = node.params;

    const settings = await settingsStore.get();
    const providerId = options.providerId || 'openai';
    const preset = getProviderPreset(providerId);
    const stored = settings.providers[providerId];
    if (!preset || !stored?.apiKey) {
      fail(`No API key configured for ${preset?.name ?? providerId}. Add one in Settings.`);
      return;
    }
    const modelId = params.model || 'gpt-image-1';
    const baseUrl = stored.baseUrl || preset.baseUrl;

    const provider = createOpenAiProvider({ apiKey: stored.apiKey, baseUrl });
    const upstream = canvasStore.upstreamNodes(canvasId, node.id);
    let rawPrompt = params.prompt;
    let images: Uint8Array[] = [];

    const readRefBytes = async (rel: string): Promise<void> => {
      try {
        images.push(new Uint8Array(await readCanvasAsset(dataRoot, rel)));
      } catch {
        /* ignore unreadable asset */
      }
    };

    // Reference anchors: attached `anchor` nodes are ordered first (character →
    // style → content) and described by a semantic prefix. NOT IP-Adapter —
    // just an ordered pile + wording (see referenceAnchors.ts / docs).
    // Within a role, honour the `ref_N` slot number the edge carries.
    const slotByAnchor = new Map<string, number>();
    for (const e of canvasStore.getSnapshot(canvasId)?.edges ?? []) {
      if (e.targetId !== node.id) continue;
      const m = /^ref_(\d+)$/.exec(e.targetHandle ?? '');
      if (m) slotByAnchor.set(e.sourceId, Number(m[1]));
    }
    const anchorNodes = upstream
      .filter((u) => u.type === 'anchor')
      .sort((a, b) => (slotByAnchor.get(a.id) ?? 99) - (slotByAnchor.get(b.id) ?? 99));
    const { orderedAssetRefs: anchorRefs, promptPrefix } = planAnchors(
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
      1,
    );
    for (const rel of anchorRefs) await readRefBytes(rel);
    if (promptPrefix) rawPrompt = `${promptPrefix}\n${rawPrompt}`;

    if (rawPrompt.includes('@')) {
      // @-mentions resolve against the whole canvas by id (the chip picker and
      // the agent can both reference a node that is not wired in as an edge).
      const candidates = (canvasStore.getSnapshot(canvasId)?.nodes ?? [])
        .filter((u) => u.id !== node.id && u.type !== 'anchor')
        .map((u) => ({
          id: u.id,
          label: u.title || '',
          assets: u.output?.assets ?? [],
        }));
      const { resolvedPrompt, orderedAssetRefs } = resolveMentions(rawPrompt, candidates, anchorRefs.length + 1);
      rawPrompt = resolvedPrompt;
      for (const rel of orderedAssetRefs) await readRefBytes(rel);
    }

    if (images.length === 0) {
      images = await upstreamImageBytes(canvasStore, dataRoot, canvasId, node.id);
    }

    images = images.slice(0, MAX_REFERENCE_IMAGES);
    const prompt = images.length > 0 ? { text: rawPrompt, images } : rawPrompt;

    const result = await generateImage({
      model: provider.image(modelId),
      prompt,
      size: params.size ?? '1024x1024',
    });

    const dir = canvasAssetsDir(dataRoot, canvasId);
    await mkdir(dir, { recursive: true });
    const rels: string[] = [];
    let n = 0;
    for (const image of result.images) {
      const ext = image.mediaType?.includes('jpeg') ? 'jpg' : 'png';
      const file = `${node.id}-${Date.now().toString(36)}-${n}.${ext}`;
      await writeFile(path.join(dir, file), Buffer.from(image.uint8Array));
      rels.push(`${canvasId}/${file}`);
      n += 1;
    }

    const prevAssets = node.output?.assets ?? [];
    const combinedAssets = [...rels, ...prevAssets.filter((p) => !rels.includes(p))].slice(0, 10);

    const done = canvasStore.updateNode(canvasId, node.id, {
      runState: 'done',
      output: { assets: combinedAssets },
      paramsHash: inputHash(node, upstream),
    });
    if (done) {
      channel.broadcast(done.rev, {
        type: 'node_output',
        id: node.id,
        output: done.node.output ?? { assets: combinedAssets },
        runState: 'done',
      });
      // Include self: it just ran, so its own `dirty` clears.
      broadcastDownstreamDirty(canvasStore, canvasId, node.id, done.rev, false);
    }
  } catch (err) {
    const classified = classifyMediaError(err);
    if (classified.raw !== classified.message) {
      console.warn(`[canvas] image node ${node.id} failed: ${classified.raw}`);
    }
    fail(classified.message);
  }
}

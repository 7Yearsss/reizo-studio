import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import type { CanvasStore } from '../storage/canvasStore';
import { readCanvasAsset } from './imageExecutor';

/** Bump when the on-disk shape of `workflow.json` changes incompatibly. */
export const WORKFLOW_VERSION = 1;
export const WORKFLOW_ASSET_PREFIX = 'assets/';

function extOf(rel: string): string {
  const e = rel.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return e || 'bin';
}

export interface WorkflowManifest {
  version: number;
  meta: { app: 'reizo'; title: string; exportedAt: string };
  viewport?: { x: number; y: number; zoom: number };
  nodes: unknown[];
  edges: unknown[];
  /** Asset paths that could not be read at export time. */
  warnings: string[];
}

/**
 * Package a canvas into a portable `.reizo.zip`:
 *   workflow.json          — nodes, edges, meta; asset paths rewritten to `assets/<sha256>.<ext>`
 *   assets/<sha256>.<ext>   — every referenced image / video, content-addressed (identical bytes stored once)
 *
 * Missing assets are skipped and listed in `manifest.warnings` rather than
 * aborting the export.
 */
export async function exportWorkflowZip(options: {
  canvasStore: CanvasStore;
  dataRoot: string;
  canvasId: string;
  title?: string;
  viewport?: { x: number; y: number; zoom: number };
}): Promise<Uint8Array> {
  const { canvasStore, dataRoot, canvasId, title, viewport } = options;
  const snap = canvasStore.getSnapshot(canvasId);
  if (!snap) throw new Error('canvas not found');

  const files: Record<string, Uint8Array> = {};
  const remap = new Map<string, string>(); // original rel -> assets/<hash>.<ext>
  const warnings: string[] = [];

  const refs = new Set<string>();
  for (const n of snap.nodes) for (const a of n.output?.assets ?? []) refs.add(a);

  for (const rel of refs) {
    try {
      const bytes = new Uint8Array(await readCanvasAsset(dataRoot, rel));
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
      const zipPath = `${WORKFLOW_ASSET_PREFIX}${hash}.${extOf(rel)}`;
      remap.set(rel, zipPath);
      files[zipPath] = bytes; // content-addressed: identical bytes collapse to one entry
    } catch {
      warnings.push(rel);
    }
  }

  const stripCanvasId = <T extends { canvasId?: string }>(row: T): Omit<T, 'canvasId'> => {
    const copy = { ...row };
    delete copy.canvasId;
    return copy;
  };

  const nodes = snap.nodes.map((n) => ({
    ...stripCanvasId(n),
    output: n.output
      ? {
          ...n.output,
          assets: (n.output.assets ?? [])
            .map((a) => remap.get(a))
            .filter((a): a is string => Boolean(a)),
        }
      : n.output,
  }));
  const edges = snap.edges.map((e) => stripCanvasId(e));

  const manifest: WorkflowManifest = {
    version: WORKFLOW_VERSION,
    meta: { app: 'reizo', title: title || 'canvas', exportedAt: new Date().toISOString() },
    ...(viewport ? { viewport } : {}),
    nodes,
    edges,
    warnings,
  };
  files['workflow.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return zipSync(files, { level: 6 });
}

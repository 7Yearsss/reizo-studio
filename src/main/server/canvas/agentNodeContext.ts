import { tool } from 'ai';
import { z } from 'zod';
import type { CanvasNode } from '../../../shared/canvas';
import type { CanvasStore } from '../storage/canvasStore';
import { readCanvasAsset } from './assets';

/** Read-only canvas introspection, scoped to one canvas id (no writes, no session). */
export function readOnlyCanvasTools(canvasStore: CanvasStore, canvasId: string, canRead: () => boolean) {
  const brief = (node: CanvasNode) => {
    const params = node.params as Record<string, unknown>;
    return {
      id: node.id,
      type: node.type,
      title: node.title || null,
      runState: node.runState,
      prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
      instruction: typeof params.instruction === 'string' ? params.instruction : undefined,
      assetCount: node.output?.assets?.length ?? 0,
      text: node.output?.text,
      error: node.output?.error,
    };
  };
  return {
    read_canvas: tool({
      description: 'List every node on this canvas with its type, run state, prompt/instruction and outputs, plus the edges.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!canRead()) return { error: 'Run stopped' };
        const snap = canvasStore.getSnapshot(canvasId);
        return {
          nodes: (snap?.nodes ?? []).map(brief),
          edges: (snap?.edges ?? []).map((e) => ({ source: e.sourceId, target: e.targetId })),
        };
      },
    }),
    read_node: tool({
      description: 'Read one canvas node in full by id (params, run state, output text/assets/error).',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        if (!canRead()) return { error: 'Run stopped' };
        const node = canvasStore.getNode(canvasId, id);
        return node ? brief(node) : { error: `No canvas node "${id}"` };
      },
    }),
  };
}

/** Compact context describing what feeds this agent node. */
export function upstreamContext(upstream: CanvasNode[]): string {
  if (upstream.length === 0) return '';
  const lines = upstream.map((n) => {
    const p = n.params as Record<string, unknown>;
    if (n.type === 'image') {
      const assets = n.output?.assets?.length ?? 0;
      return `- [image node ${n.id}] prompt: "${typeof p.prompt === 'string' ? p.prompt : ''}" (${assets} image(s) generated)`;
    }
    const text = n.output?.text ? `\n  result: ${n.output.text.slice(0, 800)}` : '';
    return `- [agent node ${n.id}] task: "${typeof p.instruction === 'string' ? p.instruction : ''}"${text}`;
  });
  return `Connected input nodes:\n${lines.join('\n')}`;
}

export async function collectUpstreamImages(
  dataRoot: string | undefined,
  upstream: CanvasNode[],
  canRead: () => boolean,
): Promise<Array<{ bytes: Uint8Array; mediaType: string }>> {
  if (!dataRoot || !canRead()) return [];
  const out: Array<{ bytes: Uint8Array; mediaType: string }> = [];
  for (const node of upstream) {
    if (node.type !== 'image') continue;
    const assets = node.output?.assets ?? [];
    for (const rel of assets.slice(0, 2)) {
      try {
        const buf = await readCanvasAsset(dataRoot, rel);
        if (!canRead()) return [];
        const lower = rel.toLowerCase();
        const mediaType = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
        out.push({ bytes: new Uint8Array(buf), mediaType });
      } catch {
        if (!canRead()) return [];
        /* skip unreadable asset */
      }
    }
  }
  return out;
}


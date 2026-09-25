import type { FilePart, ModelMessage, TextPart } from 'ai';
import type { CanvasStore } from '../storage/canvasStore';
import { readCanvasAsset } from '../canvas/imageExecutor';

/** Cap on canvas images inlined into one user message. */
const MAX_INLINE_IMAGES = 4;
/** Skip oversized files rather than blowing the request body. */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

const REF_LINE_RE = /^- ([A-Za-z0-9_-]+) \[image, done\]/gm;

/** Image node ids listed in a user message's "Referenced canvas nodes:" block. */
export function referencedImageNodeIds(content: string): string[] {
  const at = content.lastIndexOf('Referenced canvas nodes:');
  if (at < 0) return [];
  const ids: string[] = [];
  for (const m of content.slice(at).matchAll(REF_LINE_RE)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.slice(0, MAX_INLINE_IMAGES);
}

function mediaTypeOf(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * Give the model eyes on the images the user referenced: the latest user
 * message's referenced image nodes are attached as image parts (their active
 * version), so the product/subject is identified from pixels, not guessed.
 */
export async function inlineCanvasRefImages(
  history: ModelMessage[],
  options: { canvasStore?: CanvasStore; sessionId: string; dataRoot?: string },
): Promise<void> {
  const { canvasStore, sessionId, dataRoot } = options;
  if (!canvasStore || !dataRoot) return;
  let idx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      idx = i;
      break;
    }
  }
  const message = idx >= 0 ? history[idx] : undefined;
  if (message?.role !== 'user' || typeof message.content !== 'string') return;
  const ids = referencedImageNodeIds(message.content);
  if (ids.length === 0) return;
  const canvas = canvasStore.findCanvasBySession(sessionId);
  if (!canvas) return;

  const parts: Array<TextPart | FilePart> = [];
  for (const id of ids) {
    const node = canvasStore.getNode(canvas.id, id);
    const assets = node?.output?.assets ?? [];
    const rel = assets[node?.output?.activeAssetIndex ?? 0] ?? assets[0];
    if (!node || !rel) continue;
    try {
      const bytes = await readCanvasAsset(dataRoot, rel);
      if (bytes.byteLength > MAX_INLINE_BYTES) continue;
      parts.push({ type: 'text', text: `Image of canvas node ${id} (${node.title || 'untitled'}):` });
      parts.push({ type: 'file', data: new Uint8Array(bytes), mediaType: mediaTypeOf(rel) });
    } catch {
      /* skip unreadable asset */
    }
  }
  if (parts.length === 0) return;
  history[idx] = { role: 'user', content: [{ type: 'text', text: message.content }, ...parts] };
}

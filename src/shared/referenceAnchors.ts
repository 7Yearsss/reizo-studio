import type { AnchorRole, AnchorStrength } from './canvas';

/**
 * Reference-anchor planning.
 *
 * IMPORTANT — this is NOT IP-Adapter / Character Reference. The `ai` SDK's
 * `generateImage({ prompt: { text, images } })` has no per-image role/weight
 * slot, so v1 gives the model:
 *   1. an ordered pile of reference images (`<<<image N>>>` placeholders), and
 *   2. a Chinese semantic prefix telling it which image is the character, which
 *      is the style, and how strictly to hold each.
 * Anything stronger needs a dedicated image provider path (see docs).
 */

export interface AnchorRef {
  id: string;
  role: AnchorRole;
  strength: AnchorStrength;
  note?: string;
  title: string;
  /** The anchor's stored image(s); only `[0]` is used. */
  assets: string[];
}

export interface AnchorPlan {
  /** Asset paths in `<<<image N>>>` order, sorted character → style → content. */
  orderedAssetRefs: string[];
  /** Text prepended to the prompt; empty when no anchor has a usable image. */
  promptPrefix: string;
}

const ROLE_ORDER: Record<AnchorRole, number> = { character: 0, style: 1, content: 2 };

const ROLE_VERB: Record<AnchorRole, string> = {
  character: '中角色的面部特征、发型与服装',
  style: '的整体色调、光影与笔触风格',
  content: '的构图与场景元素',
};

const STRENGTH_WORD: Record<AnchorStrength, string> = {
  low: '大致参考',
  mid: '尽量贴近',
  high: '严格保持完全一致',
};

/**
 * @param anchors   attached anchors (any order); ones without an image are dropped
 * @param startIndex first `<<<image N>>>` number (1 unless something is numbered ahead)
 */
export function planAnchors(anchors: AnchorRef[], startIndex = 1): AnchorPlan {
  const usable = anchors
    .filter((a) => (a.assets?.[0] ?? '').length > 0)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);

  if (usable.length === 0) return { orderedAssetRefs: [], promptPrefix: '' };

  const orderedAssetRefs: string[] = [];
  const clauses: string[] = [];
  usable.forEach((anchor, i) => {
    const n = startIndex + i;
    orderedAssetRefs.push(anchor.assets[0]);
    const note = anchor.note?.trim() ? `（${anchor.note.trim()}）` : '';
    clauses.push(`${STRENGTH_WORD[anchor.strength]} <<<image ${n}>>>${ROLE_VERB[anchor.role]}${note}`);
  });

  return { orderedAssetRefs, promptPrefix: `${clauses.join('；')}。` };
}

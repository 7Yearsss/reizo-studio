import type { CanvasStore } from '../storage/canvasStore';

/**
 * Lightweight, non-blocking heuristics that flag likely-missing pieces of a
 * pipeline before `run_graph` dispatches. These are deliberately simple
 * patterns from real gap scenarios — not a graph validator. Warnings ride
 * along with the normal result so the agent can decide to fill the gap, ask
 * the user, or run anyway; nothing here blocks execution.
 */

/** Intent words that imply a voiced/spoken deliverable. */
const VOICEOVER_INTENT = /广告|带货|口播|短剧|宣传片|旁白|配音|ugc|voiceover|\bad(s)?\b/i;

/** Handles that wire a consistency reference onto an image/video node. */
const REFERENCE_HANDLE = /^(reference|ref_\d+)$/;

/** Node types that can carry script/voiceover content upstream of a video. */
const SCRIPT_SOURCES = new Set(['note', 'agent', 'audio']);

export function findLikelyGaps(
  canvasStore: CanvasStore,
  canvasId: string,
  scope: string[],
  intentText?: string,
): string[] {
  const snap = canvasStore.getSnapshot(canvasId);
  if (!snap) return [];
  const warnings: string[] = [];
  const byId = new Map(snap.nodes.map((n) => [n.id, n] as const));
  const scopeSet = new Set(scope);
  const scopeNodes = snap.nodes.filter((n) => scopeSet.has(n.id));
  const wantsVoiceover = VOICEOVER_INTENT.test(intentText ?? '');

  // 1) Video nodes with no script/voiceover source upstream.
  const videos = scopeNodes.filter((n) => n.type === 'video');
  const unscripted = videos.filter(
    (v) =>
      !snap.edges.some((e) => {
        if (e.targetId !== v.id) return false;
        const src = byId.get(e.sourceId);
        return src != null && SCRIPT_SOURCES.has(src.type);
      }),
  );
  if (unscripted.length > 0 && (wantsVoiceover || unscripted.length === videos.length)) {
    warnings.push(
      `${unscripted.length} 个视频镜头未连接脚本/配音来源节点（note/agent/audio）——口播类成片可能缺台词`,
    );
  }

  // 2) Multi-shot image set with no consistency reference wired.
  const images = scopeNodes.filter((n) => n.type === 'image');
  const hasReference = images.some((img) =>
    snap.edges.some((e) => e.targetId === img.id && REFERENCE_HANDLE.test(e.targetHandle ?? '')),
  );
  if (images.length >= 2 && !hasReference) {
    warnings.push(
      `${images.length} 张镜头图未绑定角色/风格参考（reference/ref_N 边）——跨镜主体一致性可能漂移`,
    );
  }

  // 3) Voiced-ad intent but no audio deliverable anywhere on the canvas.
  if (wantsVoiceover && videos.length > 0 && !snap.nodes.some((n) => n.type === 'audio')) {
    warnings.push('需求涉及口播/配音，但画布上没有音频节点——成片将是无声画面');
  }

  return warnings;
}

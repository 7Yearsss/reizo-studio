export function imageLineWidth(brushScreenPx: number, displayWidth: number, naturalWidth: number): number {
  if (displayWidth <= 0 || naturalWidth <= 0) return Math.max(1, brushScreenPx);
  return Math.max(1, (brushScreenPx * naturalWidth) / displayWidth);
}

export function outpaintResultSize(
  srcW: number,
  srcH: number,
  pad: { left: number; right: number; top: number; bottom: number },
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(srcW * (1 + Math.max(0, pad.left) + Math.max(0, pad.right)))),
    h: Math.max(1, Math.round(srcH * (1 + Math.max(0, pad.top) + Math.max(0, pad.bottom)))),
  };
}

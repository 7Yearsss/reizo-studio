/**
 * Scale factor for floating node chrome (headers, action bars, handles,
 * floating panels) rendered inside the zoomed node transform.
 *
 * - Zoomed out (<1): fully inverse-compensated — controls keep a constant,
 *   clickable screen size down to bird's-eye view.
 * - Zoomed in (>1): grows sub-proportionally (√zoom) so chrome tracks the
 *   enlarging node instead of looking stranded at a fixed size — at 200% the
 *   node is huge but the buttons stay desktop-small without this.
 */
export function chromeScale(zoom: number): number {
  const z = Math.max(0.01, zoom || 1);
  if (z < 1) return Math.min(8, 1 / z);
  return Math.max(0.35, 1 / Math.sqrt(z));
}

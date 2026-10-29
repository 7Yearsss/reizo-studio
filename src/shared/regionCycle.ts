/** Next region for F6 (forward) / Shift+F6 (backward), wrapping. With nothing focused yet, forward starts at the first and backward at the last. */
export function nextRegionIndex(count: number, current: number, reverse: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return reverse ? count - 1 : 0;
  return (current + (reverse ? count - 1 : 1)) % count;
}

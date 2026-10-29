/** Move the item at `index` by `delta` positions, clamped to the list. Returns the same array when nothing moves. */
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  if (index < 0 || index >= items.length) return items;
  const target = Math.max(0, Math.min(items.length - 1, index + delta));
  if (target === index) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

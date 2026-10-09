/**
 * Office read_* tools page by size, not just by item count. Their results are
 * clipped to a per-tool budget before they reach the model (modelHistory.ts), and
 * a clip cuts JSON mid-structure with no "next page" signal. Staying under
 * READ_PAGE_BUDGET keeps the clip from ever firing and lets the tool report an
 * explicit nextOffset instead.
 */
export const READ_PAGE_BUDGET = 6_000;
/** Ceiling the generic clip applies to office read_* results: page budget + wrapper metadata. */
export const READ_TOOL_CLIP = 12_000;

/** Leading items whose JSON size fits `budget`; always at least one so paging makes progress. */
export function takeWithinBudget<T>(items: readonly T[], budget = READ_PAGE_BUDGET): T[] {
  const taken: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (taken.length > 0 && used + size > budget) break;
    taken.push(item);
    used += size;
  }
  return taken;
}

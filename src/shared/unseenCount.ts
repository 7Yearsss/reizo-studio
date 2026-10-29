/** Messages that arrived while the reader was scrolled away; capped so the badge never gets wide. */
export function unseenCount(total: number, seenAtLeave: number, cap = 99): number {
  return Math.max(0, Math.min(cap, total - seenAtLeave));
}

export function unseenLabel(count: number, cap = 99): string {
  return count >= cap ? `${cap}+` : String(count);
}

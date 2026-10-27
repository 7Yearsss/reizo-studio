/**
 * Where a conversation should scroll while a reply streams. By default that is the end. With the question anchored,
 * it is the point that keeps the user's last message at the top of the view, so a long reply grows below it instead
 * of pushing the question out of sight. It never moves the view upward: a reader who has scrolled on keeps their place.
 */
export function followScrollTop(input: { scrollTop: number; maxScroll: number; questionTop?: number; margin?: number }): number {
  const { scrollTop, maxScroll, questionTop, margin = 12 } = input;
  if (questionTop === undefined) return maxScroll;
  const anchor = Math.max(0, questionTop - margin);
  return Math.max(scrollTop, Math.min(maxScroll, anchor));
}

/** Whether the view still counts as "following" (so streaming keeps moving it) given the line it would follow to. */
export function isFollowing(input: { scrollTop: number; followTo: number; threshold: number }): boolean {
  return input.scrollTop >= input.followTo - input.threshold;
}

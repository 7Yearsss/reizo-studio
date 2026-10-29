export const INTENT_WINDOW_MS = 800;

/**
 * Whether the conversation should keep following the live edge after a scroll event.
 * Following is released only by the user (wheel, touch, key, scrollbar drag) moving away from the end;
 * a scroll caused by layout shifting under a still reader must not drop it. Reaching the end re-engages it.
 */
export function nextFollowState(input: {
  following: boolean;
  distanceFromEnd: number;
  threshold: number;
  msSinceUserIntent: number;
}): boolean {
  const { following, distanceFromEnd, threshold, msSinceUserIntent } = input;
  if (distanceFromEnd <= threshold) return true;
  if (!following) return false;
  return msSinceUserIntent > INTENT_WINDOW_MS;
}

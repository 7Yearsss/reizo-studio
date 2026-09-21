/**
 * Mid-turn steering inbox (DSH's "next-step" lane): messages pushed while a
 * turn is live. `prepareStep` drains this at the next step boundary — between
 * tool calls — so the model sees the item in the SAME turn instead of it
 * queueing for the next one. Anything still pending when the turn ends is
 * returned by `drainSteerInbox` for the renderer to park in its queue.
 *
 * Leaf module (no imports from runtime/session) so producers like jobWatch
 * can push without creating import cycles.
 */
export interface SteerItem {
  /** Client-supplied id — the persisted user message reuses it. */
  id: string;
  /** Persisted bubble content: user text + any canvas-ref block (same shape as a normal user message). */
  content: string;
  /**
   * System-injected note (e.g. background job completion) rather than a user
   * steer — the model-facing copy gets a different prefix so it isn't treated
   * as a user request.
   */
  system?: boolean;
}

const steerInbox = new Map<string, SteerItem[]>();

export function pushSteer(sessionId: string, item: SteerItem): void {
  const list = steerInbox.get(sessionId) ?? [];
  list.push(item);
  steerInbox.set(sessionId, list);
}

export function drainSteerInbox(sessionId: string): SteerItem[] {
  const list = steerInbox.get(sessionId) ?? [];
  steerInbox.delete(sessionId);
  return list;
}

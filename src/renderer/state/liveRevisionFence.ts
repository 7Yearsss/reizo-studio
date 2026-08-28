import type { LiveEnvelope } from '../../shared/liveRevision';

/**
 * Pure state machine that decides what to do with each `LiveEnvelope` a chat
 * stream delivers, so a reconnect / window reload / backend restart can be
 * stitched back together without dropping events or flashing the whole
 * history.
 *
 * Not wired into the renderer yet — Phase 3 does that. Built and tested now
 * because it's pure and load-bearing.
 */

export type FenceAction =
  | 'apply' // in order — project it and advance the cursor
  | 'drop' // already seen, or belongs to another session — ignore
  | 'resync'; // gap or epoch change — refetch the REST snapshot, then completeResync

export interface Fence {
  sessionId: string;
  /** The turn/process epoch we're currently tracking; null until first seen. */
  epoch: string | null;
  /** Highest rev applied in order. */
  lastAppliedRev: number;
}

export function createFence(sessionId: string): Fence {
  return { sessionId, epoch: null, lastAppliedRev: 0 };
}

export function ingestEnvelope(
  fence: Fence,
  envelope: LiveEnvelope,
): { fence: Fence; action: FenceAction } {
  // Cross-session — fail closed.
  if (envelope.sessionId !== fence.sessionId) {
    return { fence, action: 'drop' };
  }

  // First envelope for a fresh fence: adopt the epoch and apply.
  if (fence.epoch === null) {
    return {
      fence: { ...fence, epoch: envelope.epoch, lastAppliedRev: envelope.rev },
      action: 'apply',
    };
  }

  // Epoch flip = the backing turn was rebuilt (process restart / new turn).
  // The rev space may not be continuous with what we have — rebuild baseline.
  if (envelope.epoch !== fence.epoch) {
    return { fence, action: 'resync' };
  }

  // Already applied (duplicate from a resume replay, or an out-of-order late
  // arrival we've moved past).
  if (envelope.rev <= fence.lastAppliedRev) {
    return { fence, action: 'drop' };
  }

  // Exactly the next one — the happy path.
  if (envelope.rev === fence.lastAppliedRev + 1) {
    return { fence: { ...fence, lastAppliedRev: envelope.rev }, action: 'apply' };
  }

  // Gap — one or more revs missing. Resync from REST, then completeResync.
  return { fence, action: 'resync' };
}

/**
 * Called after a REST snapshot has been re-projected. `snapshotRev` is the
 * highest rev that snapshot reflects (0 if unknown / no active turn).
 */
export function completeResync(fence: Fence, snapshotRev: number, epoch: string | null): Fence {
  return {
    ...fence,
    epoch,
    lastAppliedRev: Math.max(fence.lastAppliedRev, snapshotRev),
  };
}

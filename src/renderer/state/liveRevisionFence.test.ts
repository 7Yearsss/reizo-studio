import { describe, expect, it } from 'vitest';
import { completeResync, createFence, ingestEnvelope } from './liveRevisionFence';
import type { LiveEnvelope } from '../../shared/liveRevision';

function env(over: Partial<LiveEnvelope>): LiveEnvelope {
  return {
    v: 1,
    sessionId: 's1',
    rev: 1,
    epoch: 'e1',
    event: { type: 'text', delta: 'x' },
    ...over,
  };
}

describe('liveRevisionFence', () => {
  it('adopts epoch and applies the first envelope', () => {
    const { fence, action } = ingestEnvelope(createFence('s1'), env({ rev: 5, epoch: 'e1' }));
    expect(action).toBe('apply');
    expect(fence).toMatchObject({ epoch: 'e1', lastAppliedRev: 5 });
  });

  it('applies consecutive revs and advances', () => {
    let f = createFence('s1');
    ({ fence: f } = ingestEnvelope(f, env({ rev: 1 })));
    const r2 = ingestEnvelope(f, env({ rev: 2 }));
    expect(r2.action).toBe('apply');
    expect(r2.fence.lastAppliedRev).toBe(2);
  });

  it('drops a cross-session envelope', () => {
    const f = { sessionId: 's1', epoch: 'e1', lastAppliedRev: 3 };
    expect(ingestEnvelope(f, env({ sessionId: 's2', rev: 4 })).action).toBe('drop');
  });

  it('drops an already-applied rev (resume replay dedupe)', () => {
    const f = { sessionId: 's1', epoch: 'e1', lastAppliedRev: 10 };
    expect(ingestEnvelope(f, env({ rev: 7 })).action).toBe('drop');
    expect(ingestEnvelope(f, env({ rev: 10 })).action).toBe('drop');
  });

  it('resyncs on a gap', () => {
    const f = { sessionId: 's1', epoch: 'e1', lastAppliedRev: 3 };
    const { action, fence } = ingestEnvelope(f, env({ rev: 6 }));
    expect(action).toBe('resync');
    expect(fence.lastAppliedRev).toBe(3); // unchanged until completeResync
  });

  it('resyncs on an epoch change (turn/process rebuilt)', () => {
    const f = { sessionId: 's1', epoch: 'e1', lastAppliedRev: 3 };
    expect(ingestEnvelope(f, env({ rev: 4, epoch: 'e2' })).action).toBe('resync');
  });

  it('completeResync advances the cursor and re-adopts the epoch', () => {
    const f = { sessionId: 's1', epoch: 'e1', lastAppliedRev: 3 };
    const after = completeResync(f, 9, 'e2');
    expect(after).toMatchObject({ epoch: 'e2', lastAppliedRev: 9 });
    // then the next in-order envelope under e2 applies
    expect(ingestEnvelope(after, env({ rev: 10, epoch: 'e2' })).action).toBe('apply');
  });
});

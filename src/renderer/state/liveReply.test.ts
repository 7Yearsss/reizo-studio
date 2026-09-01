import { describe, expect, it } from 'vitest';
import { formatTurnElapsed, liveReplyPhase, liveReplySilence, liveReplyWaitLabel } from './liveReply';

describe('liveReplyPhase', () => {
  it('is undefined when the turn is not sending', () => {
    expect(liveReplyPhase({ sending: false, lastTextAt: 1 })).toBeUndefined();
  });

  it('does not stay on replying after text has gone quiet', () => {
    expect(
      liveReplyPhase({
        sending: true,
        lastTextAt: 10_000,
        now: 20_000,
      }),
    ).toBe('thinking');
  });

  it('is replying only while tokens are still arriving', () => {
    expect(
      liveReplyPhase({
        sending: true,
        lastTextAt: 10_000,
        now: 11_000,
      }),
    ).toBe('replying');
  });

  it('prefers tools and waiting over leftover streamed text', () => {
    expect(liveReplyPhase({ sending: true, waitingOnUser: true, lastTextAt: 1, now: 2 })).toBe('waiting');
    expect(liveReplyPhase({ sending: true, activeToolCount: 2, lastTextAt: 1, now: 2 })).toBe('tools');
  });
});

describe('liveReplySilence', () => {
  it('marks a turn quiet then stale as progress dries up', () => {
    expect(liveReplySilence({ lastProgressAt: 1_000, now: 2_000 })).toBe('live');
    expect(liveReplySilence({ lastProgressAt: 1_000, now: 10_000 })).toBe('quiet');
    expect(liveReplySilence({ lastProgressAt: 1_000, now: 50_000 })).toBe('stale');
  });
});

describe('formatTurnElapsed', () => {
  it('does not render a multi-minute turn as a raw thousand-second count', () => {
    expect(formatTurnElapsed(12_000)).toBe('12s');
    expect(formatTurnElapsed(1_950_000)).toBe('32:30');
  });
});

describe('liveReplyWaitLabel', () => {
  it('says the model has not returned yet after a long silent wait', () => {
    expect(liveReplyWaitLabel({ silence: 'live', waitedMs: 2_000 })).toBeUndefined();
    expect(liveReplyWaitLabel({ silence: 'quiet', waitedMs: 10_000 })).toBe('正在等待模型返回');
    expect(liveReplyWaitLabel({ silence: 'stale', waitedMs: 166_000 })).toBe(
      '模型还没有返回内容，已等待 2:46',
    );
  });
});

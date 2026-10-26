import { describe, expect, it } from 'vitest';
import { describeActiveWork, hasActiveWork } from './quitConfirm';

describe('quitConfirm', () => {
  it('only asks when something is running', () => {
    expect(hasActiveWork({ turns: 0, videoJobs: 0 })).toBe(false);
    expect(hasActiveWork({ turns: 1, videoJobs: 0 })).toBe(true);
    expect(hasActiveWork({ turns: 0, videoJobs: 2 })).toBe(true);
  });
  it('lists what is running in plain words', () => {
    expect(describeActiveWork({ turns: 2, videoJobs: 1 })).toEqual(['2 个对话正在回复', '1 个视频正在生成']);
    expect(describeActiveWork({ turns: 0, videoJobs: 0 })).toEqual([]);
  });
});

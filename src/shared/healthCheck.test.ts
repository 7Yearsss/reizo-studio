import { describe, expect, it } from 'vitest';
import { judgeProviderProbe, overallStatus } from './healthCheck';

describe('judgeProviderProbe', () => {
  it('a 200 is fine, slow is a warning', () => {
    expect(judgeProviderProbe('OpenAI', { status: 200, ms: 320 })).toMatchObject({ status: 'ok' });
    expect(judgeProviderProbe('OpenAI', { status: 200, ms: 9000 }).status).toBe('warn');
  });

  it('gives a bad key, a region block, a missing balance and an unreachable host different explanations', () => {
    const bad = judgeProviderProbe('X', { status: 401, ms: 100 });
    const region = judgeProviderProbe('X', { status: 403, error: 'unsupported_country_region_territory', ms: 100 });
    const money = judgeProviderProbe('X', { status: 402, ms: 100 });
    const down = judgeProviderProbe('X', { error: 'fetch failed', ms: 8000 });
    expect(bad.detail).toContain('密钥');
    expect(region.detail).toContain('地区');
    expect(region.detail).not.toContain('密钥无效');
    expect(money.detail).toContain('余额');
    expect(down.detail).toContain('连不上');
    for (const r of [bad, region, money, down]) expect(r.status).toBe('fail');
    expect(new Set([bad.detail, region.detail, money.detail, down.detail]).size).toBe(4);
  });

  it('a 404 on the listing means the host answered', () => {
    const r = judgeProviderProbe('Gateway', { status: 404, ms: 80 });
    expect(r.status).toBe('ok');
    expect(r.detail).toContain('未能验证密钥');
  });

  it('the worst result sets the overall status', () => {
    const r = (status: 'ok' | 'warn' | 'fail') => ({ id: 'x', label: 'x', status, detail: '' });
    expect(overallStatus([r('ok'), r('warn')])).toBe('warn');
    expect(overallStatus([r('ok'), r('fail'), r('warn')])).toBe('fail');
    expect(overallStatus([])).toBe('ok');
  });
});

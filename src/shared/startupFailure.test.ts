import { describe, expect, it } from 'vitest';
import { describeStartupFailure, isDatabaseFailure } from './startupFailure';

const ctx = { dataRoot: 'C:/Users/me/AppData/Roaming/Reizo/data', version: '0.1.1', backups: ['reizo.db.pre-0015_session_trash.bak'] };

describe('describeStartupFailure', () => {
  it('recognises database failures', () => {
    expect(isDatabaseFailure(new Error('Migration 0016_x failed: no such column'))).toBe(true);
    expect(isDatabaseFailure(new Error('database disk image is malformed'))).toBe(true);
    expect(isDatabaseFailure(new Error('EADDRINUSE 47100'))).toBe(false);
  });

  it('for a database failure: says nothing was deleted, names the folder, lists the copies and how to go back', () => {
    const view = describeStartupFailure(new Error('Migration 0016_x failed: boom'), ctx);
    expect(view.title).toContain('数据库');
    expect(view.message).toContain('没有被删除');
    expect(view.message).toContain(ctx.dataRoot);
    expect(view.message).toContain('reizo.db.pre-0015_session_trash.bak');
    expect(view.message).toContain('改名为 reizo.db');
  });

  it('with no copy available it says to keep a copy of the folder first', () => {
    const view = describeStartupFailure(new Error('SQLITE_CORRUPT'), { ...ctx, backups: [] });
    expect(view.message).toContain('没有找到自动副本');
  });

  it('masks secrets in the reason and the report, and clips it', () => {
    const view = describeStartupFailure(new Error(`bad sk-abcdefghijklmnopqrstuvwxyz0123456789 ${'x'.repeat(2000)}`), ctx);
    expect(view.detail).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(view.report).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(view.detail.length).toBeLessThanOrEqual(600);
    expect(view.report).toContain('Reizo 0.1.1');
  });

  it('a non-database failure gets the general wording', () => {
    expect(describeStartupFailure(new Error('EADDRINUSE'), ctx).title).toBe('Reizo 启动失败');
  });
});

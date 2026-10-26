import { describe, expect, it } from 'vitest';
import { appApprovalNeed, AppApprovalNeededError, judgeForegroundApp } from './computerAppPolicy';

describe('apps that need the user\'s go-ahead', () => {
  it('browsers, chat apps and mail clients are gated, whatever the case or extension', () => {
    expect(appApprovalNeed({ process: 'chrome.exe' })).toMatchObject({ key: 'chrome', kind: '浏览器', name: 'chrome' });
    expect(appApprovalNeed({ process: 'WeChat' })).toMatchObject({ kind: '聊天软件' });
    expect(appApprovalNeed({ process: 'OUTLOOK.EXE' })).toMatchObject({ kind: '邮件客户端' });
    expect(appApprovalNeed({ process: 'Feishu' })?.kind).toBe('聊天软件');
  });

  it('ordinary apps, unknown apps and failed detection are not gated', () => {
    expect(appApprovalNeed({ process: 'notepad' })).toBeNull();
    expect(appApprovalNeed({ process: 'excel' })).toBeNull();
    expect(appApprovalNeed(null)).toBeNull();
  });

  it('gating is separate from the hard deny list: a gated app is still allowed once approved', () => {
    expect(judgeForegroundApp({ process: 'chrome' }).verdict).toBe('allow');
    expect(judgeForegroundApp({ process: 'powershell' }).verdict).toBe('deny');
    expect(appApprovalNeed({ process: 'powershell' })).toBeNull();
  });

  it('the error names the app and its kind', () => {
    const err = new AppApprovalNeededError({ key: 'chrome', kind: '浏览器', name: 'chrome' });
    expect(err.message).toContain('浏览器');
    expect(err.message).toContain('chrome');
  });
});

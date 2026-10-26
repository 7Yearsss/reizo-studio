import { describe, expect, it } from 'vitest';
import { judgeForegroundApp } from './computerAppPolicy';

const verdict = (process: string, pid?: number) => judgeForegroundApp({ process, pid }, 4242).verdict;

describe('computer app policy', () => {
  it('refuses terminals, IDEs, password managers and system tools', () => {
    for (const name of ['powershell.exe', 'WindowsTerminal.exe', 'cmd', 'Terminal', 'iTerm2', 'Code.exe', 'idea64.exe', '1Password.exe', 'KeePassXC', 'Keychain Access', 'Taskmgr.exe', 'regedit.exe', 'Activity Monitor']) {
      expect(verdict(name), name).toBe('deny');
    }
  });
  it('refuses Reizo itself by pid or name', () => {
    expect(verdict('electron.exe', 4242)).toBe('deny');
    expect(verdict('Reizo Studio.exe', 1)).toBe('deny');
  });
  it('allows ordinary apps and an unknown foreground', () => {
    for (const name of ['notepad.exe', 'EXCEL.EXE', 'chrome.exe', 'Finder', 'photoshop.exe']) expect(verdict(name, 1), name).toBe('allow');
    expect(judgeForegroundApp(null).verdict).toBe('allow');
  });
  it('explains the denial', () => {
    const result = judgeForegroundApp({ process: 'powershell.exe', title: 'Windows PowerShell' }, 1);
    expect(result.verdict === 'deny' && result.reason).toContain('终端');
  });
});

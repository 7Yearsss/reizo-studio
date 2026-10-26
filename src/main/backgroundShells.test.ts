import { afterEach, describe, expect, it } from 'vitest';
import { listBackgroundShells, readBackgroundShell, startBackgroundShell, stopAllBackgroundShells, stopBackgroundShell } from './backgroundShells';

const until = async (check: () => boolean, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
};

afterEach(() => stopAllBackgroundShells());

describe('background shells', () => {
  it('keeps a process running, hands out only new output on each read, and stops on request', async () => {
    const info = startBackgroundShell({ sessionId: 's1', cwd: process.cwd(), command: 'node -e "console.log(\'ready\');setTimeout(function(){console.log(\'later\')},400);setInterval(function(){},1000)"' });
    expect(info.running).toBe(true);

    await until(() => (readBackgroundShell(info.id, 's1')?.output ?? '').includes('ready'));
    const first = readBackgroundShell(info.id, 's1')!;
    expect(first.running).toBe(true);

    await until(() => (readBackgroundShell(info.id, 's1', first.nextOffset)?.output ?? '').includes('later'));
    const second = readBackgroundShell(info.id, 's1', first.nextOffset)!;
    expect(second.output).not.toContain('ready'); // already seen

    expect(stopBackgroundShell(info.id, 's1')).toBe(true);
    await until(() => readBackgroundShell(info.id, 's1')?.running === false);
    expect(listBackgroundShells('s1')[0].running).toBe(false);
  });

  it('a process that exits reports its exit code; another session cannot read or stop it', async () => {
    const info = startBackgroundShell({ sessionId: 's2', cwd: process.cwd(), command: 'node -e "console.log(1);process.exit(3)"' });
    await until(() => readBackgroundShell(info.id, 's2')?.running === false);
    expect(readBackgroundShell(info.id, 's2')?.exitCode).toBe(3);
    expect(readBackgroundShell(info.id, 'other')).toBeNull();
    expect(stopBackgroundShell(info.id, 'other')).toBe(false);
  });

  it('caps how many run at once per session', () => {
    for (let i = 0; i < 5; i++) startBackgroundShell({ sessionId: 's3', cwd: process.cwd(), command: 'node -e "setInterval(function(){},1000)"' });
    expect(() => startBackgroundShell({ sessionId: 's3', cwd: process.cwd(), command: 'node -e "1"' })).toThrow('最多');
  });
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CursorPoint, InputBackend } from './types';
import { normalizeHotkey } from '../../shared/computerUse';

const run = promisify(execFile);

/** macOS `key code` numbers for the named keys we support. */
const MAC_KEYCODE: Record<string, number> = {
  Return: 36,
  Enter: 36,
  Tab: 48,
  Space: 49,
  space: 49,
  Delete: 51,
  Backspace: 51,
  BackSpace: 51,
  Escape: 53,
  Esc: 53,
  Left: 123,
  Right: 124,
  Down: 125,
  Up: 126,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  ForwardDelete: 117,
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
};

const MAC_MOD: Record<string, string> = {
  ctrl: 'control down',
  alt: 'option down',
  shift: 'shift down',
  meta: 'command down',
};

function osaEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function osa(script: string): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script], { timeout: 15_000 });
  return stdout.trim();
}

function createMacBackend(): InputBackend {
  const clickAt = (p: CursorPoint | null, kind: string) =>
    p
      ? osa(`tell application "System Events" to ${kind} at {${Math.round(p.x)}, ${Math.round(p.y)}}`)
      : osa(`tell application "System Events" to ${kind}`);

  return {
    platform: 'darwin',
    async move(p) {
      // System Events has no bare "move"; a 0-distance drag positions the pointer.
      await osa(
        `tell application "System Events" to tell (first process whose frontmost is true) to set position of it to it`,
      ).catch((): void => undefined);
      await clickAt(p, 'mouse moved to').catch((): void => undefined);
    },
    async click(button, p) {
      if (button === 'right') return void (await clickAt(p, 'right click'));
      await clickAt(p, 'click');
    },
    async doubleClick(p) {
      await clickAt(p, 'double click');
    },
    async mouseDown(p) {
      await clickAt(p, 'mouse down');
    },
    async mouseUp(p) {
      await clickAt(p, 'mouse up');
    },
    async drag(from, to) {
      const a = from ? `{${Math.round(from.x)}, ${Math.round(from.y)}}` : 'missing value';
      await osa(
        `tell application "System Events"\n${
          from ? `mouse down at ${a}` : 'mouse down'
        }\ndelay 0.05\nmouse up at {${Math.round(to.x)}, ${Math.round(to.y)}}\nend tell`,
      );
    },
    async scroll(_p, direction, clicks) {
      const n = Math.max(1, clicks);
      const axis = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
      const sign = direction === 'up' || direction === 'left' ? 1 : -1;
      await osa(
        `tell application "System Events" to scroll ${axis} by ${sign * n * 3}`,
      ).catch((): void => undefined);
    },
    async typeText(text) {
      await osa(`tell application "System Events" to keystroke "${osaEscape(text)}"`);
    },
    async pressKey(combo) {
      const parts = normalizeHotkey(combo).split('+').filter(Boolean);
      const mods = parts.filter((p) => MAC_MOD[p]).map((p) => MAC_MOD[p]);
      const key = parts.find((p) => !MAC_MOD[p]);
      const using = mods.length ? ` using {${mods.join(', ')}}` : '';
      if (key && MAC_KEYCODE[key] !== undefined) {
        await osa(`tell application "System Events" to key code ${MAC_KEYCODE[key]}${using}`);
      } else if (key && /^[a-z0-9]$/i.test(key)) {
        await osa(`tell application "System Events" to keystroke "${key.toLowerCase()}"${using}`);
      } else {
        throw new Error(`Unsupported key combination: ${combo}`);
      }
    },
    async cursorPosition() {
      // Not exposed by System Events; report origin.
      return { x: 0, y: 0 };
    },
    dispose() {
      /* no persistent process */
    },
  };
}

function createLinuxBackend(): InputBackend {
  const xdo = (args: string[]) => run('xdotool', args, { timeout: 15_000 });
  const btn = (b: 'left' | 'right' | 'middle') => (b === 'left' ? '1' : b === 'middle' ? '2' : '3');
  const at = (p: CursorPoint | null) => (p ? ['mousemove', String(Math.round(p.x)), String(Math.round(p.y))] : []);

  return {
    platform: 'linux',
    async move(p) {
      await xdo(['mousemove', String(Math.round(p.x)), String(Math.round(p.y))]);
    },
    async click(button, p) {
      if (p) await xdo(at(p));
      await xdo(['click', btn(button)]);
    },
    async doubleClick(p) {
      if (p) await xdo(at(p));
      await xdo(['click', '--repeat', '2', '1']);
    },
    async mouseDown(p) {
      if (p) await xdo(at(p));
      await xdo(['mousedown', '1']);
    },
    async mouseUp(p) {
      if (p) await xdo(at(p));
      await xdo(['mouseup', '1']);
    },
    async drag(from, to) {
      if (from) await xdo(['mousemove', String(Math.round(from.x)), String(Math.round(from.y))]);
      await xdo(['mousedown', '1']);
      await xdo(['mousemove', String(Math.round(to.x)), String(Math.round(to.y))]);
      await xdo(['mouseup', '1']);
    },
    async scroll(p, direction, clicks) {
      if (p) await xdo(at(p));
      const b = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7';
      await xdo(['click', '--repeat', String(Math.max(1, clicks)), b]);
    },
    async typeText(text) {
      await xdo(['type', '--', text]);
    },
    async pressKey(combo) {
      const parts = normalizeHotkey(combo).split('+').filter(Boolean);
      const map: Record<string, string> = { ctrl: 'ctrl', alt: 'alt', shift: 'shift', meta: 'super' };
      const key = parts.map((p) => map[p] ?? p).join('+');
      await xdo(['key', key]);
    },
    async cursorPosition() {
      const { stdout } = await xdo(['getmouselocation', '--shell']);
      const x = /X=(\d+)/.exec(stdout)?.[1];
      const y = /Y=(\d+)/.exec(stdout)?.[1];
      return { x: Number(x ?? 0), y: Number(y ?? 0) };
    },
    dispose() {
      /* no persistent process */
    },
  };
}

export function createPosixInputBackend(platform: NodeJS.Platform): InputBackend {
  return platform === 'darwin' ? createMacBackend() : createLinuxBackend();
}

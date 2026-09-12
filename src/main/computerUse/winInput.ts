import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CursorPoint, InputBackend } from './types';
import { normalizeHotkey } from '../../shared/computerUse';

/**
 * Windows input backend. Drives one long-lived PowerShell process; each action
 * is a single line on stdin, answered by a `<<<END>>>` sentinel on stdout. All
 * OS calls are Win32 P/Invoke defined once via `Add-Type`.
 *
 * Coordinates arrive in logical (DIP) space; Electron's main process is
 * per-monitor DPI aware so the Win32 cursor APIs want physical pixels — we
 * multiply by `scaleFactor` here.
 */

const SENTINEL = '<<<END>>>';

/** xdotool-ish key token -> Win32 virtual-key code. */
const VK: Record<string, number> = {
  Return: 0x0d,
  Enter: 0x0d,
  Tab: 0x09,
  Escape: 0x1b,
  Esc: 0x1b,
  space: 0x20,
  Space: 0x20,
  BackSpace: 0x08,
  Backspace: 0x08,
  Delete: 0x2e,
  Del: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  Prior: 0x21,
  PageUp: 0x21,
  Next: 0x22,
  PageDown: 0x22,
  Left: 0x25,
  Up: 0x26,
  Right: 0x27,
  Down: 0x28,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
};

const MOD_VK: Record<string, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, meta: 0x5b };

/** Resolve one chord (already `normalizeHotkey`-d) to `{ mods, key }` VK codes. */
export function resolveWinChord(combo: string): { mods: number[]; key: number } | null {
  const parts = normalizeHotkey(combo).split('+').filter(Boolean);
  if (parts.length === 0) return null;
  const mods: number[] = [];
  let key = 0;
  for (const part of parts) {
    if (MOD_VK[part] !== undefined) {
      mods.push(MOD_VK[part]);
      continue;
    }
    if (VK[part] !== undefined) key = VK[part];
    else if (/^[a-z0-9]$/i.test(part)) key = part.toUpperCase().charCodeAt(0);
    else if (VK[part.charAt(0).toUpperCase() + part.slice(1)] !== undefined) {
      key = VK[part.charAt(0).toUpperCase() + part.slice(1)];
    }
  }
  if (key === 0) return null;
  return { mods, key };
}

/** `x,y` (physical) or `-1,-1` for "use current position". */
export function physArg(p: CursorPoint | null, scaleFactor: number): string {
  if (!p) return '-1 -1';
  return `${Math.round(p.x * scaleFactor)} ${Math.round(p.y * scaleFactor)}`;
}

const BOOTSTRAP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ReizoWin32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern short VkKeyScan(char ch);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const uint MOVE=0x0001, LDOWN=0x0002, LUP=0x0004, RDOWN=0x0008, RUP=0x0010;
  public const uint MDOWN=0x0020, MUP=0x0040, WHEEL=0x0800, HWHEEL=0x1000;
  public const uint KEYUP=0x0002, UNICODE=0x0004;
}
"@
function P([int]$x,[int]$y){ if($x -ge 0 -and $y -ge 0){ [ReizoWin32]::SetCursorPos($x,$y) | Out-Null; Start-Sleep -Milliseconds 12 } }
function Btn([string]$b,[bool]$down){
  switch($b){
    'left'   { if($down){[ReizoWin32]::mouse_event([ReizoWin32]::LDOWN,0,0,0,[IntPtr]::Zero)} else {[ReizoWin32]::mouse_event([ReizoWin32]::LUP,0,0,0,[IntPtr]::Zero)} }
    'right'  { if($down){[ReizoWin32]::mouse_event([ReizoWin32]::RDOWN,0,0,0,[IntPtr]::Zero)} else {[ReizoWin32]::mouse_event([ReizoWin32]::RUP,0,0,0,[IntPtr]::Zero)} }
    'middle' { if($down){[ReizoWin32]::mouse_event([ReizoWin32]::MDOWN,0,0,0,[IntPtr]::Zero)} else {[ReizoWin32]::mouse_event([ReizoWin32]::MUP,0,0,0,[IntPtr]::Zero)} }
  }
}
function TypeUnicode([string]$s){
  foreach($ch in $s.ToCharArray()){
    $u=[int][char]$ch
    [ReizoWin32]::keybd_event(0,$u,[ReizoWin32]::UNICODE,[IntPtr]::Zero)
    [ReizoWin32]::keybd_event(0,$u,[ReizoWin32]::UNICODE -bor [ReizoWin32]::KEYUP,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 6
  }
}
function KeyCombo([int[]]$mods,[int]$key){
  foreach($m in $mods){ [ReizoWin32]::keybd_event([byte]$m,0,0,[IntPtr]::Zero) }
  [ReizoWin32]::keybd_event([byte]$key,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [ReizoWin32]::keybd_event([byte]$key,0,[ReizoWin32]::KEYUP,[IntPtr]::Zero)
  [array]::Reverse($mods)
  foreach($m in $mods){ [ReizoWin32]::keybd_event([byte]$m,0,[ReizoWin32]::KEYUP,[IntPtr]::Zero) }
}
function Wheel([int]$dx,[int]$dy){
  if($dy -ne 0){ [ReizoWin32]::mouse_event([ReizoWin32]::WHEEL,0,0,[uint32]($dy),[IntPtr]::Zero) }
  if($dx -ne 0){ [ReizoWin32]::mouse_event([ReizoWin32]::HWHEEL,0,0,[uint32]($dx),[IntPtr]::Zero) }
}
Write-Output '<<<READY>>>'
`;

export function createWindowsInputBackend(): InputBackend {
  let ps: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  let pending: { resolve: (lines: string[]) => void; reject: (e: Error) => void } | null = null;
  let acc: string[] = [];

  function ensure(): ChildProcessWithoutNullStreams {
    if (ps) return ps;
    ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n/, '');
        if (line.includes('<<<READY>>>')) continue;
        if (line.includes(SENTINEL)) {
          const done = pending;
          const lines = acc;
          pending = null;
          acc = [];
          done?.resolve(lines);
        } else if (line.trim()) {
          acc.push(line.trim());
        }
      }
    });
    ps.on('exit', () => {
      ps = null;
      pending?.reject(new Error('PowerShell input helper exited'));
      pending = null;
    });
    ps.stdin.write(`${BOOTSTRAP}\n`);
    return ps;
  }

  /** Run one PowerShell body, resolve with the non-sentinel stdout lines it emitted. */
  function run(body: string): Promise<string[]> {
    const proc = ensure();
    if (pending) return Promise.reject(new Error('input backend is busy'));
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending) {
          pending = null;
          acc = [];
          reject(new Error('PowerShell input command timed out'));
        }
      }, 15_000);
      pending = {
        resolve: (lines) => {
          clearTimeout(timer);
          const err = lines.find((l) => l.startsWith('ERR '));
          if (err) reject(new Error(err.slice(4)));
          else resolve(lines);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      proc.stdin.write(`try { ${body} } catch { Write-Output ("ERR " + $_.Exception.Message) }\nWrite-Output '${SENTINEL}'\n`);
    });
  }

  const settle = () => new Promise((r) => setTimeout(r, 15));

  return {
    platform: 'win32',
    async move(p, sf) {
      await run(`P ${physArg(p, sf)}`);
    },
    async click(button, p, sf) {
      await run(`P ${physArg(p, sf)}; Btn '${button}' $true; Start-Sleep -Milliseconds 20; Btn '${button}' $false`);
      await settle();
    },
    async doubleClick(p, sf) {
      await run(
        `P ${physArg(p, sf)}; Btn 'left' $true; Btn 'left' $false; Start-Sleep -Milliseconds 60; Btn 'left' $true; Btn 'left' $false`,
      );
      await settle();
    },
    async mouseDown(p, sf) {
      await run(`P ${physArg(p, sf)}; Btn 'left' $true`);
    },
    async mouseUp(p, sf) {
      await run(`P ${physArg(p, sf)}; Btn 'left' $false`);
    },
    async drag(from, to, sf) {
      await run(
        `P ${physArg(from, sf)}; Btn 'left' $true; Start-Sleep -Milliseconds 40; P ${physArg(to, sf)}; Start-Sleep -Milliseconds 40; Btn 'left' $false`,
      );
      await settle();
    },
    async scroll(p, direction, clicks, sf) {
      const step = 120 * Math.max(1, clicks);
      const dx = direction === 'right' ? step : direction === 'left' ? -step : 0;
      const dy = direction === 'up' ? step : direction === 'down' ? -step : 0;
      await run(`P ${physArg(p, sf)}; Wheel ${dx} ${dy}`);
      await settle();
    },
    async typeText(text) {
      const b64 = Buffer.from(text, 'utf8').toString('base64');
      await run(
        `$s=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); TypeUnicode $s`,
      );
    },
    async pressKey(combo) {
      const resolved = resolveWinChord(combo);
      if (!resolved) throw new Error(`Unsupported key combination: ${combo}`);
      const mods = resolved.mods.length ? `@(${resolved.mods.join(',')})` : '@()';
      await run(`KeyCombo ${mods} ${resolved.key}`);
    },
    async cursorPosition(sf) {
      const lines = await run(
        `$p=New-Object ReizoWin32+POINT; [ReizoWin32]::GetCursorPos([ref]$p) | Out-Null; Write-Output ("POS " + $p.X + " " + $p.Y)`,
      );
      const hit = lines.find((l) => l.startsWith('POS '));
      if (!hit) throw new Error('could not read cursor position');
      const [, x, y] = hit.split(/\s+/);
      return { x: Math.round(Number(x) / sf), y: Math.round(Number(y) / sf) };
    },
    dispose() {
      if (ps) {
        try {
          ps.stdin.end();
          ps.kill();
        } catch {
          /* already gone */
        }
        ps = null;
      }
    },
  };
}

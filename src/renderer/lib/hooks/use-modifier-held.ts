import { useEffect, useState } from 'react';
import { SHORTCUT_HINT_DELAY_MS } from '../../../shared/tabShortcut';

/**
 * True while Ctrl (Cmd on macOS) has been held alone for a moment. Pressing any other key, releasing it, or the window losing
 * focus cancels it at once, so the hint never lingers or flashes during an ordinary shortcut.
 */
export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    const cancel = (): void => { window.clearTimeout(timer); setHeld(false); };
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.key === 'Meta' : e.key === 'Control';
      if (mod && !e.repeat) { window.clearTimeout(timer); timer = window.setTimeout(() => setHeld(true), SHORTCUT_HINT_DELAY_MS); }
      else if (!mod && !/^[1-9]$/.test(e.key)) cancel();
    };
    const onKeyUp = (e: KeyboardEvent): void => { if (e.key === 'Control' || e.key === 'Meta') cancel(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, []);
  return held;
}

/** True the instant Ctrl (Cmd on macOS) goes down and until it comes up — for UI that flips with the modifier, no hint delay. */
export function useModifierDown(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    const sync = (e: KeyboardEvent): void => setDown(isMac ? e.metaKey : e.ctrlKey);
    const clear = (): void => setDown(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return (): void => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return down;
}

import { execFileSync } from 'node:child_process';
import type { ComputerController, CursorPoint, InputBackend, ScreenSize, Screenshot } from './types';
import { captureScreen } from './capture';
import { createWindowsInputBackend } from './winInput';
import { createPosixInputBackend } from './posixInput';
import { describeDenial, judgeForegroundApp } from '../../shared/computerAppPolicy';
import { posixForegroundApp } from './foreground';
import { computerActivity } from './activity';
import { ACTION_SETTLE_MS, clampPoint, createComputerBudget, isActingStep, type ComputerInput } from '../../shared/computerUse';

/** Controllers with a live task. `stopAllComputerControl` cuts every one of them off at once. */
const active = new Set<{ stop(): void }>();

/** The user's emergency brake: the next action of every live computer-use task is refused. Returns how many were stopped. */
export function stopAllComputerControl(): number {
  const count = active.size;
  for (const handle of active) handle.stop();
  return count;
}

/** Whether this OS can be driven at all. Cheap; safe to call at startup. */
export function isComputerUseSupported(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32' || platform === 'darwin') return true;
  if (platform === 'linux') {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
    try {
      execFileSync('which', ['xdotool'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function createBackend(): InputBackend {
  return process.platform === 'win32'
    ? createWindowsInputBackend()
    : createPosixInputBackend(process.platform);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One controller per live turn. Holds the input backend and the last
 * screenshot's geometry so incoming image-space coordinates can be mapped to
 * the display's logical space before they reach the OS.
 */
export function createComputerController(): ComputerController {
  const backend = createBackend();
  // Step and time limits live here, in the main process, so nothing in the renderer or the model can reset them.
  const budget = createComputerBudget();
  let stopped = false;
  const handle = { stop: () => { stopped = true; computerActivity.release(handle); } };
  active.add(handle);
  let lastImageSize: ScreenSize | null = null;
  let logicalSize: ScreenSize | null = null;
  let scaleFactor = 1;

  async function shoot(): Promise<Screenshot> {
    const shot = await captureScreen();
    lastImageSize = shot.imageSize;
    logicalSize = shot.logicalSize;
    scaleFactor = shot.scaleFactor;
    return shot;
  }

  /** Map an image-space point to logical (DIP) space, clamped to the display. */
  function toLogical(p: { x?: number; y?: number }): CursorPoint | null {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    const img = lastImageSize;
    const log = logicalSize;
    if (!img || !log || img.width === 0 || img.height === 0) {
      return log ? clampPoint({ x: p.x, y: p.y }, log) : { x: Math.round(p.x), y: Math.round(p.y) };
    }
    const mapped = { x: (p.x * log.width) / img.width, y: (p.y * log.height) / img.height };
    return clampPoint(mapped, log);
  }

  return {
    screenshot: shoot,

    async run(action: ComputerInput) {
      if (stopped) throw new Error('用户已按下停止键，电脑操作已中止。请向用户确认下一步，不要继续操作。');
      if (isActingStep(action)) {
        // The model picks the coordinates, so judge what is actually in front right now. Detection failure allows
        // the action (a missing check must not brick the feature), but a known-forbidden app never does.
        const front = await (backend.foregroundApp ? backend.foregroundApp() : posixForegroundApp()).catch((): null => null);
        const judged = judgeForegroundApp(front);
        if (front && judged.verdict === 'deny') throw new Error(describeDenial(front, judged.reason));
      }
      budget.charge(action);
      if (isActingStep(action)) computerActivity.touch(handle);
      if (!lastImageSize && action.action !== 'screenshot' && action.action !== 'wait') {
        await shoot();
      }
      switch (action.action) {
        case 'screenshot':
          await shoot();
          break;
        case 'wait':
          await sleep(action.ms ?? 800);
          break;
        case 'cursor_position':
          break;
        case 'move':
          await backend.move(toLogical(action) ?? { x: 0, y: 0 }, scaleFactor);
          break;
        case 'left_click':
          await backend.click('left', toLogical(action), scaleFactor);
          break;
        case 'right_click':
          await backend.click('right', toLogical(action), scaleFactor);
          break;
        case 'middle_click':
          await backend.click('middle', toLogical(action), scaleFactor);
          break;
        case 'double_click':
          await backend.doubleClick(toLogical(action), scaleFactor);
          break;
        case 'left_mouse_down':
          await backend.mouseDown(toLogical(action), scaleFactor);
          break;
        case 'left_mouse_up':
          await backend.mouseUp(toLogical(action), scaleFactor);
          break;
        case 'left_click_drag': {
          const from = toLogical({ x: action.fromX, y: action.fromY });
          const to = toLogical({ x: action.x, y: action.y }) ?? { x: 0, y: 0 };
          await backend.drag(from, to, scaleFactor);
          break;
        }
        case 'scroll':
          await backend.scroll(toLogical(action), action.direction, action.amount ?? 3, scaleFactor);
          break;
        case 'type':
          await backend.typeText(action.text);
          break;
        case 'key':
          await backend.pressKey(action.keys);
          break;
      }

      if (action.action !== 'screenshot' && action.action !== 'wait' && action.action !== 'cursor_position') {
        await sleep(ACTION_SETTLE_MS);
      }

      let cursor: CursorPoint | null = null;
      try {
        cursor = await backend.cursorPosition(scaleFactor);
      } catch {
        cursor = null;
      }
      return { cursor };
    },

    dispose() {
      active.delete(handle);
      computerActivity.release(handle);
      backend.dispose();
    },
  };
}

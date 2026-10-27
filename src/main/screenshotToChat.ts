import { desktopCapturer, screen } from 'electron';
import { IPC } from '../shared/constants';
import { getMainWindow } from './window';

const MAX_EDGE = 2560;
/** Time for the window to leave the screen before the frame is taken. */
const HIDE_SETTLE_MS = 250;

export type ScreenshotPayload = { dataUrl: string } | { error: string };

/**
 * Global "screenshot to chat": hide Reizo, grab the display under the cursor, bring Reizo back and hand the image to
 * the renderer, which attaches it to the current conversation. The whole display is taken; cropping is the user's
 * next step in the composer.
 */
export async function screenshotToChat(): Promise<void> {
  const win = getMainWindow();
  const hidden = Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  if (hidden) win!.hide();
  let payload: ScreenshotPayload;
  try {
    if (hidden) await new Promise<void>((resolve) => { setTimeout(resolve, HIDE_SETTLE_MS); });
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    let image = source?.thumbnail;
    if (!image || image.isEmpty()) throw new Error('截屏失败：没有拿到画面（系统可能拒绝了屏幕录制权限）');
    const size = image.getSize();
    const longest = Math.max(size.width, size.height);
    if (longest > MAX_EDGE) image = image.resize({ width: Math.round((size.width * MAX_EDGE) / longest), height: Math.round((size.height * MAX_EDGE) / longest), quality: 'good' });
    payload = { dataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}` };
  } catch (error) {
    payload = { error: error instanceof Error ? error.message : '截屏失败' };
  }
  const target = getMainWindow();
  if (!target || target.isDestroyed()) return;
  target.show();
  target.focus();
  target.webContents.send(IPC.SCREENSHOT_TO_CHAT, payload);
}

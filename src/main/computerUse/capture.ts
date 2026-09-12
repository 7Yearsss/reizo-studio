import { desktopCapturer, screen } from 'electron';
import type { Screenshot } from './types';
import { MAX_SCREENSHOT_EDGE } from '../../shared/computerUse';

/**
 * Capture the primary display with Electron's built-in `desktopCapturer` — no
 * native module. The thumbnail is requested at physical resolution then
 * downscaled so its longest edge is <= `maxEdge`; the returned `imageSize` is
 * the coordinate space the agent then works in.
 */
export async function captureScreen(maxEdge = MAX_SCREENSHOT_EDGE): Promise<Screenshot> {
  const primary = screen.getPrimaryDisplay();
  const logicalSize = { width: primary.size.width, height: primary.size.height };
  const scaleFactor = primary.scaleFactor || 1;
  const physical = {
    width: Math.round(logicalSize.width * scaleFactor),
    height: Math.round(logicalSize.height * scaleFactor),
  };

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: physical,
  });
  if (sources.length === 0) {
    throw new Error('No screen source available for capture');
  }
  const source =
    sources.find((s) => s.display_id && s.display_id === String(primary.id)) ?? sources[0];

  let image = source.thumbnail;
  if (image.isEmpty()) {
    throw new Error('Screen capture returned an empty image (permission denied?)');
  }

  const raw = image.getSize();
  const longest = Math.max(raw.width, raw.height);
  if (longest > maxEdge) {
    const ratio = maxEdge / longest;
    image = image.resize({
      width: Math.max(1, Math.round(raw.width * ratio)),
      height: Math.max(1, Math.round(raw.height * ratio)),
      quality: 'good',
    });
  }

  const imageSize = image.getSize();
  return { png: image.toPNG(), imageSize, logicalSize, scaleFactor };
}

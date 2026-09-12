import type { CursorPoint, ScreenSize } from '../../shared/computerUse';

export type { CursorPoint, ScreenSize };

export interface Screenshot {
  /** PNG bytes of the (possibly downscaled) primary display. */
  png: Buffer;
  /** Pixel dimensions of `png` — the coordinate space the model works in. */
  imageSize: ScreenSize;
  /** Logical (DIP) size of the display. */
  logicalSize: ScreenSize;
  /** Display scale factor (physical / logical). */
  scaleFactor: number;
}

/**
 * OS input backend. Every coordinate is in **logical (DIP)** space — the same
 * space as Electron's `screen` module. `scaleFactor` is passed so a backend
 * that needs physical pixels (Windows) can convert.
 */
export interface InputBackend {
  readonly platform: NodeJS.Platform;
  move(p: CursorPoint, scaleFactor: number): Promise<void>;
  click(button: 'left' | 'right' | 'middle', p: CursorPoint | null, scaleFactor: number): Promise<void>;
  doubleClick(p: CursorPoint | null, scaleFactor: number): Promise<void>;
  mouseDown(p: CursorPoint | null, scaleFactor: number): Promise<void>;
  mouseUp(p: CursorPoint | null, scaleFactor: number): Promise<void>;
  drag(from: CursorPoint | null, to: CursorPoint, scaleFactor: number): Promise<void>;
  scroll(
    p: CursorPoint | null,
    direction: 'up' | 'down' | 'left' | 'right',
    clicks: number,
    scaleFactor: number,
  ): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(combo: string): Promise<void>;
  cursorPosition(scaleFactor: number): Promise<CursorPoint>;
  dispose(): void;
}

export interface ComputerController {
  screenshot(): Promise<Screenshot>;
  run(action: import('../../shared/computerUse').ComputerInput): Promise<{ cursor: CursorPoint | null }>;
  dispose(): void;
}

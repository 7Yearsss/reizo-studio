import { afterEach, describe, expect, it } from 'vitest';
import { isComputerUseSupported } from './controller';

const savedDisplay = process.env.DISPLAY;
const savedWayland = process.env.WAYLAND_DISPLAY;

afterEach(() => {
  if (savedDisplay === undefined) delete process.env.DISPLAY;
  else process.env.DISPLAY = savedDisplay;
  if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
  else process.env.WAYLAND_DISPLAY = savedWayland;
});

describe('isComputerUseSupported', () => {
  it('is true on Windows and macOS', () => {
    expect(isComputerUseSupported('win32')).toBe(true);
    expect(isComputerUseSupported('darwin')).toBe(true);
  });

  it('is false on Linux with no display server', () => {
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    expect(isComputerUseSupported('linux')).toBe(false);
  });

  it('is false on an unknown platform', () => {
    expect(isComputerUseSupported('aix' as NodeJS.Platform)).toBe(false);
  });
});

import type { CSSProperties } from 'react';

export interface LetterTileInfo {
  letter: string;
  hue: number;
}

/**
 * Computes a deterministic letter and hue from a display name or identifier.
 * Used for fallback tiles when an external logo is unavailable or fails to load.
 */
export function letterTile(name: string): LetterTileInfo {
  const trimmed = (name ?? '').trim();
  // Strip leading non-alphanumeric punctuation (e.g. '@', '/', '.', '-') for a cleaner initial
  const stripped = trimmed.replace(/^[@./#_-]+/, '') || trimmed;
  const chars = Array.from(stripped);
  const letter = (chars[0] ?? '?').toUpperCase();

  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = ((hash << 5) - hash + trimmed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;

  return { letter, hue };
}

/**
 * Returns inline CSS properties applying a subtle deterministic hue tint.
 */
export function letterTileStyle(hue: number): CSSProperties {
  return {
    backgroundColor: `hsl(${hue} 45% 50% / 0.12)`,
    color: `hsl(${hue} 60% 60%)`,
    borderColor: `hsl(${hue} 45% 50% / 0.22)`,
  };
}

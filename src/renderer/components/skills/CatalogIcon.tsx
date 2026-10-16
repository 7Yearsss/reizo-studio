import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { letterTile, letterTileStyle } from './tileColor';

export interface CatalogIconProps {
  /** Array of candidate logo URLs in priority order (e.g. registry icon -> GitHub avatar -> website favicon) */
  icons?: string[];
  /** Display name used to compute deterministic fallback initial and hue */
  name: string;
  /** Optional custom CSS classes for sizing and layout (default: h-10 w-10 text-sm) */
  className?: string;
  /** If true, skip remote images and display the letter tile directly */
  letterOnly?: boolean;
}

export function CatalogIcon({ icons, name, className, letterOnly = false }: CatalogIconProps) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const iconKey = icons?.join('|') ?? '';
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [iconKey, name]);

  const { letter, hue } = letterTile(name);
  const tileStyle = letterTileStyle(hue);

  const candidates = !letterOnly && Array.isArray(icons) ? icons.filter(Boolean) : [];
  const currentSrc = index < candidates.length ? candidates[index] : null;

  const letterTileElement = (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-paper-inset text-sm font-semibold select-none',
        className,
      )}
      style={tileStyle}
      aria-hidden="true"
    >
      {letter}
    </div>
  );

  if (!currentSrc) {
    return letterTileElement;
  }

  return (
    <div
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper-inset',
        className,
      )}
    >
      {/* Fallback letter tile rendered behind the image while loading to prevent blank or broken flashes */}
      <div
        className="absolute inset-0 flex items-center justify-center text-sm font-semibold select-none"
        style={tileStyle}
        aria-hidden="true"
      >
        {letter}
      </div>
      <img
        src={currentSrc}
        alt=""
        loading="lazy"
        className={cn(
          'relative h-full w-full object-cover transition-opacity duration-150',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setIndex((prev) => prev + 1);
        }}
      />
    </div>
  );
}

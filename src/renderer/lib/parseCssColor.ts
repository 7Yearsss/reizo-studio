/** Parse `#rgb`, `#rrggbb`, or `rgb()` / `rgba()` into linear-ish 0–1 RGB. */
export function parseCssColor(input: string): [number, number, number] {
  const value = input.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0] + hex[0], 16) / 255,
        Number.parseInt(hex[1] + hex[1], 16) / 255,
        Number.parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
      ];
    }
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s/]\s*([\d.]+)/i,
  );
  if (rgb) {
    const scale = Number(rgb[1]) > 1 ? 255 : 1;
    return [Number(rgb[1]) / scale, Number(rgb[2]) / scale, Number(rgb[3]) / scale];
  }

  return [1, 1, 1];
}

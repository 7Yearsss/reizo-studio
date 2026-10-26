import { useCallback, useLayoutEffect, useState } from 'react';

// Floating canvas surfaces (composer, asset shelf, job history) stack by recency:
// whichever was opened or touched last sits on top. Starts above React Flow's panels (z 5).
let top = 10;

/** Returns a z-index that rises to the front when `active` flips on, and a `raise` for pointer-down. */
export default function useCanvasLayer(active = true) {
  const [zIndex, setZIndex] = useState(() => active ? ++top : 0);
  const raise = useCallback(() => { setZIndex((current) => current === top ? current : ++top); }, []);
  useLayoutEffect(() => { if (active) raise(); }, [active, raise]);
  return { zIndex, raise };
}

import { createContext } from 'react';

/** Embeds can keep an overview while automatic updates still highlight nodes.
 * Explicit user focus, panning and zooming remain available. */
export const CanvasAutoFocusContext = createContext(true);

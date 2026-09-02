/**
 * Which canvas nodes the user currently has selected. Ephemeral (in-memory,
 * per canvas) — it only feeds the compact canvas summary the agent gets at
 * turn start, so it does not need to survive a restart.
 */
const selectionByCanvas = new Map<string, string[]>();

export function setCanvasSelection(canvasId: string, ids: string[]): void {
  if (ids.length === 0) selectionByCanvas.delete(canvasId);
  else selectionByCanvas.set(canvasId, [...new Set(ids)].slice(0, 50));
}

export function getCanvasSelection(canvasId: string): string[] {
  return selectionByCanvas.get(canvasId) ?? [];
}

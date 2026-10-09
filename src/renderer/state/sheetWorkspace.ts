import { useSyncExternalStore } from 'react';
import type { SheetReference } from '../../shared/sheetReferences';
import { serializeSheetReference } from '../../shared/sheetReferences';

export interface SheetSelection extends SheetReference { name: string }
interface State {
  selectedBySession: Record<string, string | undefined>;
  activeBySession: Record<string, SheetSelection | undefined>;
  pinnedBySession: Record<string, SheetSelection[] | undefined>;
}
let state: State = { selectedBySession: {}, activeBySession: {}, pinnedBySession: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export function useSheetWorkspace<T>(select: (s: State) => T): T {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => select(state));
}
export function selectWorkbook(sessionId: string, artifactId: string) {
  update({ selectedBySession: { ...state.selectedBySession, [sessionId]: artifactId } });
}
export function publishSheetSelection(sessionId: string, selection: SheetSelection) {
  update({ activeBySession: { ...state.activeBySession, [sessionId]: selection } });
}
export function clearActiveSheet(sessionId: string, artifactId: string) {
  if (state.activeBySession[sessionId]?.artifactId === artifactId) update({ activeBySession: { ...state.activeBySession, [sessionId]: undefined } });
}
export function pinSheetSelection(sessionId: string) {
  const active = state.activeBySession[sessionId];
  if (!active) return;
  const pinned = state.pinnedBySession[sessionId] ?? [];
  if (!pinned.some((p) => serializeSheetReference(p) === serializeSheetReference(active))) update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: [...pinned, active].slice(-8) } });
}
export function clearPinnedSheets(sessionId: string) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: [] } }); }
export function restoreSheetReferences(sessionId: string, refs: SheetSelection[]) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: refs.slice(0, 8) } }); }
export function removePinnedSheet(sessionId: string, index: number) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: (state.pinnedBySession[sessionId] ?? []).filter((_, i) => i !== index) } }); }
export function sheetMentions(sessionId: string): string[] {
  return [...new Set([...(state.pinnedBySession[sessionId] ?? []), ...(state.activeBySession[sessionId] ? [state.activeBySession[sessionId]!] : [])].map(serializeSheetReference))];
}

export { getEditorRecovery as getSheetRecovery, setEditorRecovery as setSheetRecovery, clearEditorRecovery as clearSheetRecovery, registerEditorFlusher as registerSheetFlusher, flushArtifactEdits as flushWorkbookEdits, discardArtifactEdits as discardWorkbookEdits, trackEditorWrite as trackSheetWrite, flushEditorEdits as flushSheetEdits } from './editorPersistence';
export type { EditorRecovery as SheetRecovery } from './editorPersistence';

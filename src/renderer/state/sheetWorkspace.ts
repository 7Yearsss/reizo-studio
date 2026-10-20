import { useSyncExternalStore } from 'react';
import type { SheetReference } from '../../shared/sheetReferences';
import { labelSheetRanges, sameSheetPlace, serializeSheetReference } from '../../shared/sheetReferences';

export interface SheetSelection extends SheetReference { name: string }
interface State {
  selectedBySession: Record<string, string | undefined>;
  activeBySession: Record<string, SheetSelection | undefined>;
  pinnedBySession: Record<string, SheetSelection[] | undefined>;
  reviewRevisions: Record<string, number>;
  /** A cell a reply pointed at, waiting for the open workbook to scroll to it. */
  focusBySession: Record<string, { sheetName: string; range: string; nonce: number } | undefined>;
}
let state: State = { selectedBySession: {}, activeBySession: {}, pinnedBySession: {}, reviewRevisions: {}, focusBySession: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export function useSheetWorkspace<T>(select: (s: State) => T): T {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => select(state));
}
export function refreshSheetReviews(artifactId: string) { update({ reviewRevisions: { ...state.reviewRevisions, [artifactId]: (state.reviewRevisions[artifactId] ?? 0) + 1 } }); }
export function requestSheetFocus(sessionId: string, target: { sheetName: string; range: string }) { update({ focusBySession: { ...state.focusBySession, [sessionId]: { ...target, nonce: Date.now() } } }); }
export function selectWorkbook(sessionId: string, artifactId: string) {
  update({ selectedBySession: { ...state.selectedBySession, [sessionId]: artifactId } });
}
export function publishSheetSelection(sessionId: string, selection: SheetSelection) {
  update({ activeBySession: { ...state.activeBySession, [sessionId]: selection } });
}
export function clearActiveSheet(sessionId: string, artifactId: string) {
  if (state.activeBySession[sessionId]?.artifactId === artifactId) update({ activeBySession: { ...state.activeBySession, [sessionId]: undefined } });
}
/** Quote the live selection into the next message. Returns false when there is no cell range to quote. */
export function pinSheetSelection(sessionId: string): boolean {
  const active = state.activeBySession[sessionId];
  if (!active?.range) return false;
  const { label: _label, ...place } = active;
  const pinned = state.pinnedBySession[sessionId] ?? [];
  if (!pinned.some((p) => sameSheetPlace(p, place))) update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: [...pinned, place].slice(-8) } });
  return true;
}
export function clearPinnedSheets(sessionId: string) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: [] } }); }
/** Labels are assigned at send time; a restored message gets them again in the same order. */
export function restoreSheetReferences(sessionId: string, refs: SheetSelection[]) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: refs.slice(0, 8).map(({ label: _label, ...ref }) => ref) } }); }
export function removePinnedSheet(sessionId: string, index: number) { update({ pinnedBySession: { ...state.pinnedBySession, [sessionId]: (state.pinnedBySession[sessionId] ?? []).filter((_, i) => i !== index) } }); }
/** Pinned ranges numbered from `first` (after the document and HTML ranges) so the user can cite them as [n]. */
export function labelledPinnedSheets(sessionId: string, first = 1): SheetSelection[] { return labelSheetRanges(state.pinnedBySession[sessionId] ?? [], first); }
/** The live selection rides along unnumbered, unless the user already quoted that very range. */
export function liveSheetSelection(sessionId: string): SheetSelection | undefined {
  const active = state.activeBySession[sessionId];
  return active && !(state.pinnedBySession[sessionId] ?? []).some((p) => sameSheetPlace(p, active)) ? active : undefined;
}
export function sheetMentions(sessionId: string, first = 1): string[] {
  const live = liveSheetSelection(sessionId);
  return [...new Set([...labelledPinnedSheets(sessionId, first), ...(live ? [live] : [])].map(serializeSheetReference))];
}

export { getEditorRecovery as getSheetRecovery, setEditorRecovery as setSheetRecovery, clearEditorRecovery as clearSheetRecovery, registerEditorFlusher as registerSheetFlusher, flushArtifactEdits as flushWorkbookEdits, discardArtifactEdits as discardWorkbookEdits, trackEditorWrite as trackSheetWrite, flushEditorEdits as flushSheetEdits } from './editorPersistence';
export type { EditorRecovery as SheetRecovery } from './editorPersistence';

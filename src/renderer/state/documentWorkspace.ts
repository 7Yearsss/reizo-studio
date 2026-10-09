import { useSyncExternalStore } from 'react';
import { serializeDocumentReference, type DocumentReference } from '../../shared/documentReferences';
import type { DocumentSelection } from '../../shared/documentContent';

interface State { selected: Record<string, string | undefined>; references: Record<string, DocumentReference | undefined>; revisions: Record<string, number> }
let state: State = { selected: {}, references: {}, revisions: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); }
export function useDocumentWorkspace<T>(select: (s: State) => T): T {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => select(state));
}
export function selectDocument(sessionId: string, id: string) { update({ selected: { ...state.selected, [sessionId]: id } }); }
export function refreshDocumentReviews(id: string) { update({ revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 } }); }
export function referenceDocument(sessionId: string, ref?: DocumentReference) { update({ references: { ...state.references, [sessionId]: ref } }); }
export function documentMentions(sessionId: string): string[] { const ref = state.references[sessionId]; return ref ? [serializeDocumentReference(ref)] : []; }
function wholeDocument(ref: DocumentReference): DocumentReference { return { artifactId: ref.artifactId, name: ref.name, version: ref.version }; }
/** A selection is a pointer for one message or one stretch of editing: drop the range, keep the document in focus as a whole-document reference. */
export function dropDocumentSelection(sessionId: string) {
  const ref = state.references[sessionId];
  if (ref?.selection) referenceDocument(sessionId, wholeDocument(ref));
}
/** After an edit, keep the selection only while its text is still where it was picked. */
export function reconcileDocumentSelection(sessionId: string, artifactId: string, intact: (selection: DocumentSelection) => boolean) {
  const ref = state.references[sessionId];
  if (ref?.artifactId === artifactId && ref.selection && !intact(ref.selection)) referenceDocument(sessionId, wholeDocument(ref));
}
/** Autosave bumps the version; a still-valid selection must follow it or the server rejects it as stale. */
export function syncDocumentReferenceVersion(sessionId: string, artifactId: string, version: number) {
  const ref = state.references[sessionId];
  if (ref?.artifactId === artifactId && ref.version !== version) referenceDocument(sessionId, { ...ref, version });
}

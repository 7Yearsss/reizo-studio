import { useSyncExternalStore } from 'react';
import { serializeDocumentReference, type DocumentReference } from '../../shared/documentReferences';
import type { DocumentSelection } from '../../shared/documentContent';
import { labelSelections } from '../../shared/referenceLabels';
import { addReference, collapseSelections } from './referenceList';

interface State { selected: Record<string, string | undefined>; references: Record<string, DocumentReference[] | undefined>; revisions: Record<string, number> }
let state: State = { selected: {}, references: {}, revisions: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); }
export function useDocumentWorkspace<T>(select: (s: State) => T): T {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => select(state));
}
const EMPTY: DocumentReference[] = [];
function setReferences(sessionId: string, refs: DocumentReference[]) { if (refs !== state.references[sessionId]) update({ references: { ...state.references, [sessionId]: refs } }); }
export function selectDocument(sessionId: string, id: string) { update({ selected: { ...state.selected, [sessionId]: id } }); }
export function refreshDocumentReviews(id: string) { update({ revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 } }); }
export function documentReferences(sessionId: string): DocumentReference[] { return state.references[sessionId] ?? EMPTY; }
/** Replace everything this session references with one document (or nothing). */
export function referenceDocument(sessionId: string, ref?: DocumentReference) { setReferences(sessionId, ref ? [ref] : []); }
const overlaps = (a: DocumentReference, b: DocumentReference) => a.selection!.blockId === b.selection!.blockId && a.selection!.start < b.selection!.end && b.selection!.start < a.selection!.end;
/** Add a picked range (or the whole document) next to what is already referenced. */
export function addDocumentReference(sessionId: string, ref: DocumentReference) { setReferences(sessionId, addReference(documentReferences(sessionId), ref, overlaps)); }
export function removeDocumentReference(sessionId: string, index: number) { setReferences(sessionId, documentReferences(sessionId).filter((_, i) => i !== index)); }
export function restoreDocumentReferences(sessionId: string, refs: DocumentReference[]) { setReferences(sessionId, refs.slice(0, 8)); }
/** Picked ranges are numbered from `first` so the user can cite them as [n]. */
export function documentMentions(sessionId: string, first = 1): string[] { return labelSelections(documentReferences(sessionId), first).map(serializeDocumentReference); }
/** Selections are a pointer for one message or one stretch of editing: drop the ranges, keep each document in focus as a whole-document reference. */
export function dropDocumentSelection(sessionId: string) { setReferences(sessionId, collapseSelections(documentReferences(sessionId))); }
/** After an edit, keep each selection only while its text is still where it was picked. */
export function reconcileDocumentSelection(sessionId: string, artifactId: string, intact: (selection: DocumentSelection) => boolean) {
  setReferences(sessionId, collapseSelections(documentReferences(sessionId), (ref) => ref.artifactId !== artifactId || intact(ref.selection!)));
}
/** Autosave bumps the version; still-valid selections must follow it or the server rejects them as stale. */
export function syncDocumentReferenceVersion(sessionId: string, artifactId: string, version: number) {
  const refs = documentReferences(sessionId);
  if (refs.some((ref) => ref.artifactId === artifactId && ref.version !== version)) setReferences(sessionId, refs.map((ref) => ref.artifactId === artifactId ? { ...ref, version } : ref));
}

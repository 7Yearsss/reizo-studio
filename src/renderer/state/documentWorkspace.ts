import { useSyncExternalStore } from 'react';
import { serializeDocumentReference, type DocumentReference } from '../../shared/documentReferences';

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

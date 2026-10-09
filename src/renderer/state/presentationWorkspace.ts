import { useSyncExternalStore } from 'react';
import type { PresentationReference } from '../../shared/presentationContent';
import { serializePresentationReference } from '../../shared/presentationReferences';
interface State { selected: Record<string, string | undefined>; references: Record<string, PresentationReference | undefined>; revisions: Record<string, number> }
let state: State = { selected: {}, references: {}, revisions: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); }
export function usePresentationWorkspace<T>(select: (state: State) => T): T { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => select(state)); }
export function selectPresentation(sessionId: string, id: string) { update({ selected: { ...state.selected, [sessionId]: id } }); }
export function referencePresentation(sessionId: string, ref?: PresentationReference) { update({ references: { ...state.references, [sessionId]: ref } }); }
export function refreshPresentationReviews(id: string) { update({ revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 } }); }
export function presentationMentions(sessionId: string): string[] { const ref = state.references[sessionId]; return ref ? [serializePresentationReference(ref)] : []; }

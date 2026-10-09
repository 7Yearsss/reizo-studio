import { useSyncExternalStore } from 'react';
import { serializeHtmlReference, type HtmlReference } from '../../shared/htmlReferences';
interface State { selected: Record<string, string | undefined>; references: Record<string, HtmlReference | undefined>; revisions: Record<string, number> }
let state: State = { selected: {}, references: {}, revisions: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); }
export function useHtmlWorkspace<T>(select: (s: State) => T): T { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => select(state)); }
export function selectHtml(sessionId: string, id: string) { update({ selected: { ...state.selected, [sessionId]: id } }); }
export function referenceHtml(sessionId: string, ref?: HtmlReference) { update({ references: { ...state.references, [sessionId]: ref } }); }
export function refreshHtmlReviews(id: string) { update({ revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 } }); }
export function htmlMentions(sessionId: string): string[] { const ref = state.references[sessionId]; return ref ? [serializeHtmlReference(ref)] : []; }
/** A source selection is spent after it is sent or when the source changes under it; keep the page as a whole-page reference. */
export function dropHtmlSelection(sessionId: string) {
  const ref = state.references[sessionId];
  if (ref?.selection) referenceHtml(sessionId, { artifactId: ref.artifactId, name: ref.name, version: ref.version });
}

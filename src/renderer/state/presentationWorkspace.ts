import { useSyncExternalStore } from 'react';
import { presentationElements, type PresentationContent, type PresentationReference } from '../../shared/presentationContent';
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
/** A slide/element scope is spent after it is sent or when the deck changes under it; keep the deck as a whole-deck reference. */
export function dropPresentationScope(sessionId: string) {
  const ref = state.references[sessionId];
  if (ref && (ref.slideId || ref.elementIds?.length)) referencePresentation(sessionId, { artifactId: ref.artifactId, name: ref.name, version: ref.version });
}
/** The user's own edits keep a picked slide/element scope; only drop it once its targets are gone. */
export function prunePresentationScope(sessionId: string, content: PresentationContent) {
  const ref = state.references[sessionId];
  if (!ref?.slideId) return;
  const slide = content.slides.find((s) => s.id === ref.slideId);
  const ids = slide ? new Set(presentationElements(slide).map((e) => e.element.id)) : undefined;
  const elementIds = ref.elementIds?.filter((id) => ids?.has(id));
  if (!slide || (ref.elementIds?.length && !elementIds?.length)) dropPresentationScope(sessionId);
  else if (elementIds && elementIds.length !== ref.elementIds?.length) referencePresentation(sessionId, { ...ref, elementIds });
}

import { useSyncExternalStore } from 'react';
import { serializeHtmlReference, type HtmlReference } from '../../shared/htmlReferences';
import { labelSelections } from '../../shared/referenceLabels';
import { addReference, collapseSelections } from './referenceList';
interface State { selected: Record<string, string | undefined>; references: Record<string, HtmlReference[] | undefined>; revisions: Record<string, number> }
let state: State = { selected: {}, references: {}, revisions: {} };
const listeners = new Set<() => void>();
function update(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); }
export function useHtmlWorkspace<T>(select: (s: State) => T): T { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => select(state)); }
const EMPTY: HtmlReference[] = [];
function setReferences(sessionId: string, refs: HtmlReference[]) { if (refs !== state.references[sessionId]) update({ references: { ...state.references, [sessionId]: refs } }); }
export function selectHtml(sessionId: string, id: string) { update({ selected: { ...state.selected, [sessionId]: id } }); }
export function htmlReferences(sessionId: string): HtmlReference[] { return state.references[sessionId] ?? EMPTY; }
/** Replace everything this session references with one page (or nothing). */
export function referenceHtml(sessionId: string, ref?: HtmlReference) { setReferences(sessionId, ref ? [ref] : []); }
const overlaps = (a: HtmlReference, b: HtmlReference) => a.selection!.start < b.selection!.end && b.selection!.start < a.selection!.end;
/** Add a picked range (or the whole page) next to what is already referenced. */
export function addHtmlReference(sessionId: string, ref: HtmlReference) { setReferences(sessionId, addReference(htmlReferences(sessionId), ref, overlaps)); }
export function removeHtmlReference(sessionId: string, index: number) { setReferences(sessionId, htmlReferences(sessionId).filter((_, i) => i !== index)); }
export function restoreHtmlReferences(sessionId: string, refs: HtmlReference[]) { setReferences(sessionId, refs.slice(0, 8)); }
export function refreshHtmlReviews(id: string) { update({ revisions: { ...state.revisions, [id]: (state.revisions[id] ?? 0) + 1 } }); }
/** Picked ranges are numbered from `first` (after the document ranges) so the user can cite them as [n]. */
export function htmlMentions(sessionId: string, first = 1): string[] { return labelSelections(htmlReferences(sessionId), first).map(serializeHtmlReference); }
/** Source selections are spent once sent or when the source changes under them (pass that page); keep each page as a whole-page reference. */
export function dropHtmlSelection(sessionId: string, artifactId?: string) {
  setReferences(sessionId, collapseSelections(htmlReferences(sessionId), (ref) => artifactId !== undefined && ref.artifactId !== artifactId));
}

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createPresentationTools, presentationReviewAdapter } from './presentationTools';
import { applyPresentationEdit, createPresentation, normalizePresentation, parsePresentation, presentationElementBox, presentationElements } from '../../../shared/presentationContent';
const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = openDb(':memory:'); handles.push(db); const root = mkdtempSync(path.join(tmpdir(), 'ppt-review-'));
  const artifacts = createArtifactStore(db, root); const reviews = createArtifactReviewStore(db, artifacts, root, { presentation: presentationReviewAdapter });
  const content = createPresentation('Original title'); const artifact = await artifacts.create({ sessionId: 'ppt-session', name: 'Deck', kind: 'presentation', source: 'manual', content: JSON.stringify(content) });
  const tools = createPresentationTools({ sessionId: artifact.sessionId, artifacts, reviews });
  const call = (name: keyof typeof tools, args: unknown) => (tools[name].execute as unknown as (args: unknown, options: unknown) => Promise<Record<string, unknown>>)(args, {});
  return { artifacts, reviews, artifact, content, tools, call };
}
it('preserves element identities and rejects changes outside a selected page or element', () => {
  const content = createPresentation(); const slide = content.slides[0]; const [title, body] = presentationElements(slide);
  expect(normalizePresentation(content)).toEqual(content);
  const scope = { artifactId: 'test', name: 'test', version: 1, slideId: slide.id, elementIds: [title.element.id!] };
  expect(() => applyPresentationEdit(content, { op: 'updateElement', slideId: slide.id, elementId: body.element.id!, patch: { runs: [{ text: 'bad' }] } }, scope)).toThrow('选中');
  const next = applyPresentationEdit(content, { op: 'updateElement', slideId: slide.id, elementId: title.element.id!, patch: { runs: [{ text: 'Updated' }] } }, scope);
  expect(presentationElements(next.slides[0])[1].element).toEqual(body.element);
  expect(() => applyPresentationEdit(content, { op: 'deleteSlide', slideId: slide.id })).toThrow('1 至');
});
it('lets an element scope insert beside the selection on the same slide only', () => {
  const content = createPresentation(); content.slides.push({ ...createPresentation().slides[0] }); const deck = normalizePresentation(content);
  const [slide, other] = deck.slides; const [title] = presentationElements(slide);
  const scope = { artifactId: 'test', name: 'test', version: 1, slideId: slide.id, elementIds: [title.element.id!] };
  const element = { type: 'text', position: { x: 0, y: 0 }, size: { width: 100, height: 40 }, runs: [{ text: 'New' }] };
  expect(presentationElements(applyPresentationEdit(deck, { op: 'insertElement', slideId: slide.id, element }, scope).slides[0])).toHaveLength(3);
  expect(() => applyPresentationEdit(deck, { op: 'insertElement', slideId: other.id, element }, scope)).toThrow('引用的页面');
  expect(() => applyPresentationEdit(deck, { op: 'updateSlide', slideId: slide.id, title: 'x' }, scope)).toThrow('选中');
  const without = applyPresentationEdit(deck, { op: 'deleteElement', slideId: slide.id, elementId: title.element.id! });
  expect(() => applyPresentationEdit(without, { op: 'insertElement', slideId: slide.id, element }, scope)).toThrow('引用的元素已被删除');
});
it('tracks single container children and supports scoped descendant updates', () => {
  const content = normalizePresentation({ schemaVersion: 1, slides: [{ title: 'Container', layout: { elements: [{ type: 'container', child: { type: 'text', runs: [{ text: 'child' }] } }] } }] });
  const slide = content.slides[0]; const [container, child] = presentationElements(slide);
  const next = applyPresentationEdit(content, { op: 'deleteElement', slideId: slide.id, elementId: child.element.id! }, { artifactId: 'test', name: 'test', version: 1, slideId: slide.id, elementIds: [container.element.id!] });
  expect(presentationElements(next.slides[0])).toHaveLength(1);
});
it('canonicalizes shape aliases and applies position patches to rendered vector points', () => {
  const content = normalizePresentation({ schemaVersion: 1, slides: [{ title: 'Shapes', layout: { elements: [{ type: 'ellipse', position: { x: 10, y: 20 }, size: { width: 100, height: 50 }, fill: { color: '22AA88' } }] } }] });
  const slide = content.slides[0]; const element = presentationElements(slide)[0].element;
  expect(element.type).toBe('vector'); expect(element.shape).toBe('ellipse');
  const moved = applyPresentationEdit(content, { op: 'updateElement', slideId: slide.id, elementId: element.id!, patch: { position: { x: 200, y: 300 } } });
  expect(presentationElements(moved.slides[0])[0].element.points).toEqual([{ x: 200, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 350 }, { x: 200, y: 350 }]);
});
it('keeps text and rich-text runs consistent for either agent editing form', () => {
  const content = createPresentation('Old'); const slide = content.slides[0]; const id = slide.layout.elements![0].id!;
  const byText = applyPresentationEdit(content, { op: 'updateElement', slideId: slide.id, elementId: id, patch: { text: 'By text' } });
  expect(byText.slides[0].layout.elements?.[0].runs).toEqual([{ text: 'By text' }]);
  const byRuns = applyPresentationEdit(byText, { op: 'updateElement', slideId: slide.id, elementId: id, patch: { runs: [{ text: 'By runs' }] } });
  expect(byRuns.slides[0].layout.elements?.[0].text).toBe('By runs');
});
it('proposes without changing the source, accepts exact candidate, and blocks direct chat updates', async () => {
  const f = await fixture(); const slide = f.content.slides[0]; const title = presentationElements(slide)[0].element;
  const result = await f.call('propose_presentation_edits', { artifactId: f.artifact.id, expectedVersion: 1, operations: [{ op: 'updateElement', slideId: slide.id, elementId: title.id, patch: { runs: [{ text: 'Reviewed title' }] } }] });
  expect(result.ok).toBe(true); expect((await f.artifacts.get(f.artifact.id))?.content).toBe(f.artifact.content);
  const review = f.reviews.get(String(result.reviewId))!;
  await f.reviews.decide({ id: review.id, sessionId: f.artifact.sessionId, expectedReviewVersion: 1, changeIds: [review.changes[0].id], decision: 'accept' });
  const latest = (await f.artifacts.get(f.artifact.id))!;
  expect(latest.content).toBe(review.candidateContent); expect(latest.version).toBe(2);
  expect(parsePresentation(latest.content)?.slides[0].layout.elements?.[1]).toEqual(slide.layout.elements?.[1]);
  await expect(f.artifacts.addVersion(f.artifact.id, { content: f.artifact.content, origin: { surface: 'chat' } })).rejects.toThrow('待审核');
});
it('rejects stale versions, foreign decks, and overlapping edits', async () => {
  const f = await fixture(); const slide = f.content.slides[0]; const element = presentationElements(slide)[0].element;
  await expect(f.reviews.create({ artifactId: f.artifact.id, sessionId: f.artifact.sessionId, expectedVersion: 1, origin: { surface: 'chat' }, operations: [{ op: 'updateElement', slideId: slide.id, elementId: element.id, patch: { name: 'change' } }, { op: 'deleteSlide', slideId: slide.id }] })).rejects.toThrow('重叠');
  const foreign = await f.artifacts.create({ sessionId: 'other', name: 'private', kind: 'presentation', source: 'manual', content: f.artifact.content });
  expect((await f.call('read_presentation', { artifactId: foreign.id })).ok).toBe(false);
  await f.artifacts.addVersion(f.artifact.id, { expectedVersion: 1, origin: { surface: 'manual_edit' }, content: JSON.stringify((() => { const edited = JSON.parse(f.artifact.content); edited.slides[0].name = 'edited'; return edited; })()) });
  expect((await f.call('propose_presentation_edits', { artifactId: f.artifact.id, expectedVersion: 1, operations: [{ op: 'updateElement', slideId: slide.id, elementId: element.id, patch: { name: 'stale' } }] })).ok).toBe(false);
});
it('merges nested style patches instead of replacing them', () => {
  const content = createPresentation('Old'); const slide = content.slides[0]; const id = slide.layout.elements![0].id!;
  const red = applyPresentationEdit(content, { op: 'updateElement', slideId: slide.id, elementId: id, patch: { font: { color: 'FF0000' }, position: { y: 50 } } });
  const element = red.slides[0].layout.elements![0];
  expect(element.font).toEqual({ family: 'Arial', size: 56, bold: true, color: 'FF0000' });
  expect(element.position).toEqual({ x: 100, y: 50 });
  const plain = applyPresentationEdit(red, { op: 'updateElement', slideId: slide.id, elementId: id, patch: { font: { bold: null } } });
  expect(plain.slides[0].layout.elements![0].font).toEqual({ family: 'Arial', size: 56, color: 'FF0000' });
});
it('moves, resizes, aligns and distributes elements including vectors', () => {
  const box = (x: number, w: number) => ({ type: 'text', runs: [{ text: 't' }], position: { x, y: 100 }, size: { width: w, height: 50 } });
  const deck = normalizePresentation({ schemaVersion: 1, slides: [{ title: 'S', layout: { elements: [box(10, 100), box(300, 200), box(900, 100), { type: 'rectangle', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }] } }] });
  const slide = deck.slides[0]; const [a, b, c, shape] = presentationElements(slide).map((e) => e.element.id!);
  const frames = (next: typeof deck) => presentationElements(next.slides[0]).map((e) => presentationElementBox(e.element));
  const moved = applyPresentationEdit(deck, { op: 'transformElement', slideId: slide.id, elementId: shape, x: 50, width: 200 });
  expect(frames(moved)[3]).toEqual({ x: 50, y: 0, width: 200, height: 100 });
  expect(frames(applyPresentationEdit(deck, { op: 'arrangeElements', slideId: slide.id, elementIds: [a, b, c], align: 'right' })).slice(0, 3).map((f) => f!.x)).toEqual([900, 800, 900]);
  expect(frames(applyPresentationEdit(deck, { op: 'arrangeElements', slideId: slide.id, elementIds: [b], align: 'center' }))[1]!.x).toBe(540);
  expect(frames(applyPresentationEdit(deck, { op: 'arrangeElements', slideId: slide.id, elementIds: [c, a, b], align: 'distribute-horizontal' })).slice(0, 3).map((f) => f!.x)).toEqual([10, 405, 900]);
  const scope = { artifactId: 'test', name: 'test', version: 1, slideId: slide.id, elementIds: [a, b] };
  expect(() => applyPresentationEdit(deck, { op: 'arrangeElements', slideId: slide.id, elementIds: [a, c], align: 'left' }, scope)).toThrow('选中');
  expect(() => presentationReviewAdapter.validateBatch?.(JSON.stringify(deck), [{ op: 'arrangeElements', slideId: slide.id, elementIds: [a, b], align: 'top' }, { op: 'transformElement', slideId: slide.id, elementId: b, x: 0 }])).toThrow('合并');
});

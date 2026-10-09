import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { createArtifactStore } from '../storage/artifactStore';
import { createArtifactReviewStore } from '../storage/artifactReviewStore';
import { createPresentationTools, presentationReviewAdapter } from './presentationTools';
import { createPresentation, presentationElements, type PresentationReference } from '../../../shared/presentationContent';

const handles: ReturnType<typeof openDb>[] = [];
afterEach(() => handles.splice(0).forEach((db) => db.close()));

async function propose(ref: (ids: { artifactId: string; slideId: string; elementId: string }) => PresentationReference) {
  const db = openDb(':memory:'); handles.push(db);
  const root = mkdtempSync(path.join(tmpdir(), 'ppt-ref-version-'));
  const artifacts = createArtifactStore(db, root); const reviews = createArtifactReviewStore(db, artifacts, root, { presentation: presentationReviewAdapter });
  const deck = createPresentation('Deck'); const slide = deck.slides[0]; const element = presentationElements(slide)[0].element;
  const artifact = await artifacts.create({ sessionId: 's', name: 'Deck', kind: 'presentation', source: 'manual', content: JSON.stringify(deck) });
  const tools = createPresentationTools({ sessionId: 's', artifacts, reviews, getReferences: () => [ref({ artifactId: artifact.id, slideId: slide.id, elementId: element.id! })] });
  const run = tools.propose_presentation_edits.execute as unknown as (args: unknown, options: unknown) => Promise<Record<string, unknown>>;
  return run({ artifactId: artifact.id, expectedVersion: artifact.version, operations: [{ op: 'updateElement', slideId: slide.id, elementId: element.id, patch: { runs: [{ text: 'Updated' }] } }] }, {});
}

it('a whole-deck reference is not rejected just because the deck was autosaved since', async () => {
  expect((await propose((ids) => ({ artifactId: ids.artifactId, name: 'Deck', version: 99 }))).ok).toBe(true);
});

it('a slide/element scope survives autosaves while its targets still exist', async () => {
  expect((await propose((ids) => ({ artifactId: ids.artifactId, name: 'Deck', version: 99, slideId: ids.slideId, elementIds: [ids.elementId] }))).ok).toBe(true);
});

it('a scope whose slide was deleted asks the user to pick again', async () => {
  const out = await propose((ids) => ({ artifactId: ids.artifactId, name: 'Deck', version: 1, slideId: 'gone-slide' }));
  expect(out.ok).toBe(false);
  expect(String(out.error)).toContain('重新选择');
});

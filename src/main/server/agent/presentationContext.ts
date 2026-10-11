import type { ArtifactStore } from '../storage/artifactStore';
import { parsePresentation, presentationElementBox, presentationElements, type PresentationElement, type PresentationReference, type PresentationSlide } from '../../../shared/presentationContent';

/** Cap across every deck referenced in one message; the rest comes through read_presentation. */
export const PRESENTATION_CONTEXT_TOTAL_CHARS = 9_000;
const MAX_DECKS = 3;
const MAX_OUTLINE_SLIDES = 60;
const ELEMENT_CHARS = 700;
const WHOLE_DECK_ELEMENT_LIMIT = 40;

const quote = (text: string): string => JSON.stringify(text);
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The words an element carries, if any (text runs, a name, alt text). */
function wordsOf(element: PresentationElement): string {
  const runs = Array.isArray(element.runs) ? (element.runs as { text?: unknown }[]).map((r) => (typeof r.text === 'string' ? r.text : '')).join('') : '';
  return (runs || (typeof element.text === 'string' ? element.text : '') || (typeof element.alt === 'string' ? element.alt : '')).replace(/\s+/g, ' ').trim();
}

/** One line about an element: its id, kind, frame on the 1280x720 canvas, font and words. */
function brief(element: PresentationElement): string {
  const box = presentationElementBox(element);
  const frame = box ? ` @(${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)}` : '';
  const font = element.font as { family?: unknown; size?: unknown; bold?: unknown; color?: unknown } | undefined;
  const style = font ? ` font=${[font.family, font.size, font.bold ? 'bold' : '', font.color].filter((v) => v !== undefined && v !== '').join('/')}` : '';
  const words = wordsOf(element);
  const image = element.type === 'image' ? ' [图片]' : '';
  return `${element.id ?? '?'} ${element.type ?? 'element'}${element.name ? ` ${quote(String(element.name))}` : ''}${frame}${style}${image}${words ? `: ${quote(clip(words, ELEMENT_CHARS))}` : ''}`;
}

function slideLines(slide: PresentationSlide, index: number, only?: Set<string>): string[] {
  const lines = [`slide ${index + 1} id=${slide.id} ${quote(slide.title)}${slide.notes ? ` (has notes)` : ''}`];
  for (const { element, ancestors } of presentationElements(slide)) {
    if (only && !(element.id && only.has(element.id))) continue;
    lines.push(`  ${'  '.repeat(ancestors.length)}${brief(element)}`);
  }
  if (slide.notes && !only) lines.push(`  notes: ${quote(clip(slide.notes, 600))}`);
  return lines;
}

/**
 * What the agent needs to edit a deck straight away: the saved version, every slide's id and title, and for what
 * the user pointed at (elements, the current slide, or a small deck) each element's id, frame, font and words.
 */
export async function buildPresentationContext(store: ArtifactStore | undefined, sessionId: string, refs: PresentationReference[]): Promise<string> {
  if (!store || !refs.length) return '';
  const byDeck = new Map<string, PresentationReference[]>();
  for (const ref of refs) byDeck.set(ref.artifactId, [...(byDeck.get(ref.artifactId) ?? []), ref]);
  const sections: string[] = [];
  let remaining = PRESENTATION_CONTEXT_TOTAL_CHARS;
  for (const [artifactId, own] of [...byDeck].slice(0, MAX_DECKS)) {
    const artifact = await store.get(artifactId);
    if (!artifact || artifact.kind !== 'presentation' || artifact.sessionId !== sessionId) continue;
    const deck = parsePresentation(artifact.content);
    if (!deck) continue;
    const lines = [`Deck ${quote(artifact.name)} id=${artifact.id} version=${artifact.version} (current saved version), canvas 1280x720, ${deck.slides.length} slides`];

    const elementIds = new Set(own.flatMap((r) => r.elementIds ?? []));
    const slideIds = new Set(own.filter((r) => r.slideId).map((r) => r.slideId!));
    deck.slides.forEach((slide, index) => {
      const hasPickedElement = presentationElements(slide).some((e) => e.element.id && elementIds.has(e.element.id));
      if (hasPickedElement) lines.push('selected elements:', ...slideLines(slide, index, elementIds));
      else if (slideIds.has(slide.id)) lines.push('current slide:', ...slideLines(slide, index));
    });
    const wholeDeck = own.some((r) => !r.slideId && !(r.elementIds?.length));
    const elementCount = deck.slides.reduce((n, s) => n + presentationElements(s).length, 0);
    if (wholeDeck) {
      if (elementCount <= WHOLE_DECK_ELEMENT_LIMIT) deck.slides.forEach((slide, index) => lines.push(...slideLines(slide, index)));
      else {
        lines.push(`outline (${elementCount} elements; use read_presentation with a slideId for a slide's elements):`);
        deck.slides.slice(0, MAX_OUTLINE_SLIDES).forEach((slide, index) => lines.push(`  slide ${index + 1} id=${slide.id} ${quote(clip(slide.title, 80))} (${presentationElements(slide).length} elements)`));
      }
    }
    const section = lines.join('\n');
    if (section.length > remaining) { sections.push(`${lines[0]}\n(content omitted to save context; use read_presentation)`); continue; }
    remaining -= section.length;
    sections.push(section);
  }
  return sections.join('\n\n');
}

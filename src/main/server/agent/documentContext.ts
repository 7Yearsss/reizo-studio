import type { ArtifactStore } from '../storage/artifactStore';
import { documentBlocks, documentSchema, documentSelectionSpans, parseDocumentContent } from '../../../shared/documentContent';
import type { DocumentReference } from '../../../shared/documentReferences';

/** Cap across every document referenced in one message; the rest comes through read_document. */
export const DOCUMENT_CONTEXT_TOTAL_CHARS = 8_000;
/** A whole-document reference is inlined only when the document is this small, otherwise just its outline. */
const WHOLE_DOCUMENT_CHARS = 4_000;
/** The surrounding paragraph shown next to a picked range, for tone and meaning. */
const PARAGRAPH_CONTEXT_CHARS = 600;
const MAX_DOCUMENTS = 4;

const quote = (text: string): string => JSON.stringify(text);
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The saved content the agent needs to act on what the user pointed at, so it can propose edits
 * straight away instead of spending a turn on read_document. Picked ranges come with their exact
 * block ids / offsets / text; a small document is inlined whole, a large one as an outline.
 */
export async function buildDocumentContext(store: ArtifactStore | undefined, sessionId: string, refs: DocumentReference[]): Promise<string> {
  if (!store || !refs.length) return '';
  const byArtifact = new Map<string, DocumentReference[]>();
  for (const ref of refs) byArtifact.set(ref.artifactId, [...(byArtifact.get(ref.artifactId) ?? []), ref]);
  const sections: string[] = [];
  let remaining = DOCUMENT_CONTEXT_TOTAL_CHARS;
  for (const [artifactId, own] of [...byArtifact].slice(0, MAX_DOCUMENTS)) {
    const artifact = await store.get(artifactId);
    if (!artifact || artifact.kind !== 'doc' || artifact.sessionId !== sessionId) continue;
    const content = parseDocumentContent(artifact.content);
    if (!content) continue;
    const doc = documentSchema.nodeFromJSON(content.doc);
    const blocks = documentBlocks(content);
    const lines: string[] = [`Document ${quote(artifact.name)} id=${artifact.id} version=${artifact.version} (current saved version)`];

    const picked = own.filter((ref) => ref.selection);
    for (const ref of picked) {
      const selection = ref.selection!;
      const spans = documentSelectionSpans(doc, selection);
      const label = ref.label ? `[${ref.label}] ` : '';
      if (!spans) { lines.push(`${label}range no longer matches the document; ask the user to select it again.`); continue; }
      lines.push(`${label}selected range, ${spans.length > 1 ? `across ${spans.length} blocks` : 'inside one block'}:`);
      for (const span of spans) {
        const block = blocks.find((b) => b.id === span.id);
        const text = doc.textBetween(span.pos + 1 + span.start, span.pos + 1 + span.end);
        lines.push(`  block ${span.id} chars ${span.start}-${span.end}${span.whole ? ' (whole block)' : ''}: ${quote(clip(text, 2_000))}`);
        if (block && !span.whole) lines.push(`    full paragraph: ${quote(clip(block.text, PARAGRAPH_CONTEXT_CHARS))}`);
      }
    }

    if (own.some((ref) => !ref.selection)) {
      const textBlocks = blocks.filter((b) => b.type !== 'table' && b.text);
      const total = textBlocks.reduce((sum, b) => sum + b.text.length, 0);
      if (total <= WHOLE_DOCUMENT_CHARS) {
        lines.push('whole document:');
        for (const b of textBlocks) lines.push(`  ${b.id} (${b.type}): ${quote(b.text)}`);
      } else {
        lines.push(`whole document is ${blocks.length} blocks, ${total} chars; outline of its headings (use read_document for the rest):`);
        for (const b of blocks.filter((x) => x.type === 'heading')) lines.push(`  ${b.id}: ${quote(clip(b.text, 120))}`);
      }
    }

    const section = lines.join('\n');
    if (section.length > remaining) { sections.push(`${lines[0]}\n(content omitted to save context; use read_document)`); continue; }
    remaining -= section.length;
    sections.push(section);
  }
  return sections.join('\n\n');
}

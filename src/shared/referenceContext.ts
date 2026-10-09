import { splitDocumentContext } from './documentReferences';
import { splitHtmlContext } from './htmlReferences';
import { splitPresentationContext } from './presentationReferences';
import { splitSheetContext } from './sheetReferences';

const PREVIEW = 40;
const clip = (text: string | undefined) => (text && text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text ?? '');

/**
 * Model-side view of an OLDER user message. Reference blocks (`<sheet-context>`
 * carries up to thousands of chars of cell data, the others a selection excerpt
 * and instructions) are only meaningful for the turn they were sent in: the file
 * has usually changed since, and replaying them every turn grows the prompt
 * quadratically. Replace them with one identity line; the agent re-reads via
 * read_* when it needs content. Persisted/UI content is never touched.
 */
export function compactReferenceContext(content: string): string {
  if (!content.includes('-context>') && !content.includes('Referenced spreadsheets')) return content;
  const presentation = splitPresentationContext(content);
  const html = splitHtmlContext(presentation.text);
  const doc = splitDocumentContext(html.text);
  const sheet = splitSheetContext(doc.text);
  const notes = [
    ...doc.refs.map((r) => `Doc ${JSON.stringify(r.name)} id=${r.artifactId}${r.selection ? ` selected${r.label ? ` [${r.label}]` : ''} ${JSON.stringify(clip(r.selection.text))}` : ''}`),
    ...sheet.refs.map((r) => `Excel ${JSON.stringify(r.name)} id=${r.artifactId}${r.sheetName ? ` sheet=${JSON.stringify(r.sheetName)}` : ''}${r.range ? ` range=${r.range}` : ''}`),
    ...presentation.refs.map((r) => `PPT ${JSON.stringify(r.name)} id=${r.artifactId}${r.slideId ? ` slide=${r.slideId}` : ''}${r.elementIds?.length ? ` elements=${r.elementIds.length}` : ''}`),
    ...html.refs.map((r) => `HTML ${JSON.stringify(r.name)} id=${r.artifactId}${r.selection ? ` selected${r.label ? ` [${r.label}]` : ''} ${JSON.stringify(clip(r.selection.text))}` : ''}`),
  ];
  if (!notes.length) return sheet.text;
  return `${sheet.text}\n\n[Files referenced in this earlier message (content omitted, may have changed — re-read with read_* before relying on it): ${notes.join('; ')}]`;
}

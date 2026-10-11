import type { ArtifactStore } from '../storage/artifactStore';
import type { HtmlReference } from '../../../shared/htmlReferences';

/** Cap across every page referenced in one message; the rest comes through read_html. */
export const HTML_CONTEXT_TOTAL_CHARS = 9_000;
const WHOLE_PAGE_CHARS = 6_000;
/** Source shown on each side of a picked range, so an exact oldText can be written without reading. */
const AROUND_CHARS = 300;
const MAX_PAGES = 3;

const lineOf = (source: string, offset: number): number => source.slice(0, offset).split('\n').length;

/**
 * The saved source the agent needs to edit what the user pointed at: the version, the exact text of each picked
 * range with its line numbers and the source around it, or the whole page when it is small.
 */
export async function buildHtmlContext(store: ArtifactStore | undefined, sessionId: string, refs: HtmlReference[]): Promise<string> {
  if (!store || !refs.length) return '';
  const byPage = new Map<string, HtmlReference[]>();
  for (const ref of refs) byPage.set(ref.artifactId, [...(byPage.get(ref.artifactId) ?? []), ref]);
  const sections: string[] = [];
  let remaining = HTML_CONTEXT_TOTAL_CHARS;
  for (const [artifactId, own] of [...byPage].slice(0, MAX_PAGES)) {
    const artifact = await store.get(artifactId);
    if (!artifact || artifact.kind !== 'html' || artifact.sessionId !== sessionId) continue;
    const source = artifact.content;
    const lines = [`Page ${JSON.stringify(artifact.name)} id=${artifact.id} version=${artifact.version} (current saved version), ${source.split('\n').length} lines, ${source.length} chars`];
    for (const ref of own.filter((r) => r.selection)) {
      const { start, end } = ref.selection!;
      if (end > source.length) { lines.push(`${ref.label ? `[${ref.label}] ` : ''}range no longer fits the page; ask the user to select it again.`); continue; }
      const current = source.slice(start, end);
      const stale = ref.selection!.text !== undefined && ref.selection!.text.slice(0, 2000) !== current.slice(0, 2000);
      lines.push(`${ref.label ? `[${ref.label}] ` : ''}selected source, chars ${start}-${end} (lines ${lineOf(source, start)}-${lineOf(source, end)})${stale ? ', but the text there has changed since it was picked' : ''}:`,
        '<<<', current.slice(0, 2000), '>>>',
        'before it:', JSON.stringify(source.slice(Math.max(0, start - AROUND_CHARS), start)), 'after it:', JSON.stringify(source.slice(end, end + AROUND_CHARS)));
    }
    if (own.some((r) => !r.selection)) {
      if (source.length <= WHOLE_PAGE_CHARS) lines.push('whole page source:', '<<<', source, '>>>');
      else lines.push(`whole page is large; the first ${Math.min(1500, source.length)} chars (use read_html for the rest):`, '<<<', source.slice(0, 1500), '>>>');
    }
    const section = lines.join('\n');
    if (section.length > remaining) { sections.push(`${lines[0]}\n(content omitted to save context; use read_html)`); continue; }
    remaining -= section.length;
    sections.push(section);
  }
  return sections.join('\n\n');
}

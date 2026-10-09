import type { ArtifactKind } from '../../../shared/artifact';
import type { ArtifactStore } from '../storage/artifactStore';

// Editable artifact kinds the agent can open, and the tool that reads each.
const READERS: Partial<Record<ArtifactKind, { label: string; tool: string }>> = {
  doc: { label: 'Doc', tool: 'read_document' },
  sheet: { label: 'Excel', tool: 'read_sheet' },
  presentation: { label: 'PPT', tool: 'read_presentation' },
  html: { label: 'HTML', tool: 'read_html' },
};
const PER_KIND = 3;
const TOTAL = 8;
const NAME_MAX = 60;
const HARD_CAP = 1400;

/**
 * Tiny, metadata-only system-prompt block naming the session's editable files.
 * Imported files live in the artifact store, not the workspace, so without this
 * the agent only learns of them from a one-shot client reference and falls back
 * to searching the filesystem. Deliberately no content, previews or versions:
 * the read_* tools return those, and a stable block keeps the prompt cacheable.
 * Bounded by per-kind and total caps plus a hard character ceiling.
 */
export async function describeSessionArtifacts(artifacts: ArtifactStore, sessionId: string): Promise<string> {
  // listBySession is already ordered newest-first (updated_at DESC).
  const all = (await artifacts.listBySession(sessionId)).flatMap((a) => { const reader = READERS[a.kind]; return reader ? [{ ...a, reader }] : []; });
  if (!all.length) return '';
  // The prompt tells the agent "the newest of that type", so every type's newest
  // file must make the list even when newer files of other types would fill it.
  const picked = new Set<string>();
  const taken = new Map<ArtifactKind, number>();
  for (const a of all) {
    if (taken.has(a.kind)) continue;
    taken.set(a.kind, 1); picked.add(a.id);
  }
  for (const a of all) {
    if (picked.size >= TOTAL) break;
    const n = taken.get(a.kind) ?? 0;
    if (picked.has(a.id) || n >= PER_KIND) continue;
    taken.set(a.kind, n + 1); picked.add(a.id);
  }
  const lines = all.filter((a) => picked.has(a.id)).map((a) => {
    const name = a.name.length > NAME_MAX ? `${a.name.slice(0, NAME_MAX)}…` : a.name;
    return `- ${a.reader.label} ${JSON.stringify(name)} id=${a.id}`;
  });
  const hidden = all.length - lines.length;
  const readers = [...new Set(all.map((a) => a.reader.tool))].join('/');
  let out = `Files already in this session (newest first; the user's imported/open files):\n${lines.join('\n')}` +
    (hidden > 0 ? `\n(+${hidden} more — call ${readers} without artifactId to list)` : '') +
    '\nThey live in the session, not the workspace: never list_dir/find_files/grep/read_file for them. "文档/表格/PPT/这个文件" means the newest of that type unless a reference says otherwise — call its read_* tool with the id directly.';
  if (out.length > HARD_CAP) out = `${out.slice(0, HARD_CAP - 1)}…`;
  return out;
}

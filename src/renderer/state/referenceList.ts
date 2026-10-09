/** A workspace file reference: the whole file, or one picked range of it. */
interface FileReference { artifactId: string; name: string; version?: number; selection?: unknown }

export const MAX_FILE_REFERENCES = 8;
const whole = <T extends FileReference>(ref: T): T => ({ artifactId: ref.artifactId, name: ref.name, version: ref.version }) as T;

/**
 * Add a reference to the list the next message carries. A picked range replaces the file's whole-file
 * reference and any range it overlaps; a whole-file reference replaces every range of that file.
 */
export function addReference<T extends FileReference>(list: T[], ref: T, overlaps: (a: T, b: T) => boolean): T[] {
  const kept = list.filter((r) => r.artifactId !== ref.artifactId || (ref.selection && r.selection && !overlaps(r, ref)));
  return [...kept, ref].slice(-MAX_FILE_REFERENCES);
}

/**
 * Turn the ranges `keep` rejects into whole-file references, without leaving a whole-file reference next to
 * ranges that survived or a duplicate of one already listed. Sending (keep nothing) and editing under a range
 * (keep what is intact) both go through here, so a file never silently drops out of focus.
 */
export function collapseSelections<T extends FileReference>(list: T[], keep: (ref: T) => boolean = () => false): T[] {
  const next = list.map((ref) => (ref.selection && !keep(ref) ? whole(ref) : ref));
  const ranged = new Set(next.filter((r) => r.selection).map((r) => r.artifactId));
  const seen = new Set<string>();
  const out = next.filter((r) => {
    if (r.selection) return true;
    if (ranged.has(r.artifactId) || seen.has(r.artifactId)) return false;
    seen.add(r.artifactId); return true;
  });
  return out.length === list.length && out.every((r, i) => r === list[i]) ? list : out;
}

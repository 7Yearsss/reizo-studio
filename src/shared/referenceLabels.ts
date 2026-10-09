/**
 * Number the picked ranges of one message 1..n so the user can write "[2] 删掉" and the agent knows which
 * range they mean. Whole-file references carry no label. Labels are assigned at display/send time, never stored.
 */
export function labelSelections<T extends { selection?: unknown; label?: number }>(refs: T[], first = 1): T[] {
  let next = first;
  return refs.map((ref) => {
    const copy = { ...ref }; delete copy.label;
    return ref.selection ? { ...copy, label: next++ } : copy;
  });
}
export function isReferenceLabel(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 99; }

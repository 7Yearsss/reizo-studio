export interface FinishInput {
  /** Sessions that were sending at the previous look, and now. */
  previous: Readonly<Record<string, boolean | undefined>>;
  next: Readonly<Record<string, boolean | undefined>>;
  /** The conversation the user is looking at right now, if any. */
  visibleSessionId?: string;
  /** Sessions that stopped because the user interrupted them. */
  interrupted?: ReadonlySet<string>;
}

/** Conversations whose reply just finished while the user was looking at something else. */
export function backgroundFinished(input: FinishInput): string[] {
  const out: string[] = [];
  for (const [id, wasSending] of Object.entries(input.previous)) {
    if (!wasSending || input.next[id]) continue;
    if (id === input.visibleSessionId) continue;
    if (input.interrupted?.has(id)) continue;
    out.push(id);
  }
  return out;
}

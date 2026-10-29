export interface PersistedQueuedTurn {
  id: string;
  text: string;
  mentions: string[];
  extra: { skillId?: string; attachments?: { name: string; content: string }[]; replaceFromId?: string };
}

/** Largest serialized queue we keep; attachment text can be big and storage is small. */
export const MAX_PERSISTED_QUEUE_BYTES = 200_000;

export function serializeQueues(queues: Record<string, PersistedQueuedTurn[] | undefined>): string {
  const entries = Object.entries(queues).filter(([, items]) => items && items.length > 0);
  const json = JSON.stringify(Object.fromEntries(entries));
  if (json.length <= MAX_PERSISTED_QUEUE_BYTES) return json;
  // Too big: keep the text of each message, drop attachment bodies rather than losing the queue.
  const slim = entries.map(([id, items]) => [id, (items ?? []).map((item) => ({ ...item, extra: { skillId: item.extra.skillId, replaceFromId: item.extra.replaceFromId } }))]);
  return JSON.stringify(Object.fromEntries(slim));
}

function isTurn(value: unknown): value is PersistedQueuedTurn {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.text === 'string' && Array.isArray(v.mentions) && v.mentions.every((m) => typeof m === 'string') && typeof v.extra === 'object' && v.extra !== null;
}

/** Tolerant parse: anything malformed is dropped, never thrown. */
export function parseQueues(raw: string | null): Record<string, PersistedQueuedTurn[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PersistedQueuedTurn[]> = {};
    for (const [sessionId, items] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      const valid = items.filter(isTurn);
      if (valid.length > 0) out[sessionId] = valid;
    }
    return out;
  } catch {
    return {};
  }
}

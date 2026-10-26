/** Unsent composer text, persisted per session. Text only: attachments, screenshots and local paths are never written. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_KEY_PREFIX = 'reizo:composer-draft:';
export const MAX_DRAFT_CHARS = 100_000;
export const MAX_DRAFTS = 100;
const INDEX_KEY = 'reizo:composer-draft-index';

function readIndex(storage: DraftStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

export function loadDraft(storage: DraftStorage, sessionId: string): string {
  try { return storage.getItem(DRAFT_KEY_PREFIX + sessionId) ?? ''; } catch { return ''; }
}

/** Empty text removes the draft; the oldest drafts are evicted beyond MAX_DRAFTS. Never throws. */
export function saveDraft(storage: DraftStorage, sessionId: string, text: string): void {
  try {
    const index = readIndex(storage).filter((id) => id !== sessionId);
    if (!text.trim()) {
      storage.removeItem(DRAFT_KEY_PREFIX + sessionId);
    } else {
      storage.setItem(DRAFT_KEY_PREFIX + sessionId, text.slice(0, MAX_DRAFT_CHARS));
      index.push(sessionId);
      while (index.length > MAX_DRAFTS) {
        const evicted = index.shift();
        if (evicted) storage.removeItem(DRAFT_KEY_PREFIX + evicted);
      }
    }
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch { /* storage unavailable or full — a draft is best-effort */ }
}

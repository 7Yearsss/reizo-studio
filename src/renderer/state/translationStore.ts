import * as api from '../api';
import type { StoredTranslation, TranslateLang, TranslationMap } from '../../shared/translation';

/** Translations per session, loaded on first use and kept in memory; the server file is the source of truth. */
type Listener = () => void;
const listeners = new Set<Listener>();
const maps = new Map<string, TranslationMap>();
const loading = new Set<string>();
const pending = new Set<string>();
let version = 0;

const emit = (): void => { version += 1; for (const l of listeners) l(); };

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getVersion(): number { return version; }

export function ensureLoaded(sessionId: string): void {
  if (maps.has(sessionId) || loading.has(sessionId)) return;
  loading.add(sessionId);
  void api.getTranslations(sessionId).then(
    (map) => { maps.set(sessionId, map); },
    (): void => { maps.set(sessionId, {}); },
  ).finally(() => { loading.delete(sessionId); emit(); });
}

export function translationsFor(sessionId: string, messageId: string): Partial<Record<TranslateLang, StoredTranslation>> {
  return maps.get(sessionId)?.[messageId] ?? {};
}

export function isTranslating(messageId: string, lang: TranslateLang): boolean { return pending.has(`${messageId}:${lang}`); }

export async function translate(sessionId: string, messageId: string, lang: TranslateLang): Promise<void> {
  const key = `${messageId}:${lang}`;
  if (pending.has(key)) return;
  pending.add(key);
  emit();
  try {
    const translation = await api.translateMessage(sessionId, messageId, lang);
    const map = { ...(maps.get(sessionId) ?? {}) };
    map[messageId] = { ...(map[messageId] ?? {}), [lang]: translation };
    maps.set(sessionId, map);
  } finally {
    pending.delete(key);
    emit();
  }
}

export async function removeTranslation(sessionId: string, messageId: string, lang: TranslateLang): Promise<void> {
  await api.deleteTranslation(sessionId, messageId, lang);
  const map = { ...(maps.get(sessionId) ?? {}) };
  const entry = { ...(map[messageId] ?? {}) };
  delete entry[lang];
  if (Object.keys(entry).length) map[messageId] = entry; else delete map[messageId];
  maps.set(sessionId, map);
  emit();
}

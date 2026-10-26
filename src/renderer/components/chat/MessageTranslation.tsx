import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Languages, X } from 'lucide-react';
import { TRANSLATE_LANGS, type TranslateLang } from '../../../shared/translation';
import * as translationStore from '../../state/translationStore';
import { toast } from '../../lib/toast';
import MarkdownContent from './MarkdownContent';

/** "翻译" in a message's action row: pick a language, the translation appears under the original and survives a reload. */
export function TranslateButton({ sessionId, messageId }: { sessionId: string; messageId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(translationStore.subscribe, translationStore.getVersion);

  async function run(lang: TranslateLang): Promise<void> {
    setOpen(false);
    try { await translationStore.translate(sessionId, messageId, lang); }
    catch (error) { toast.error('翻译失败', error instanceof Error ? error.message : undefined); }
  }

  const busy = TRANSLATE_LANGS.some((l) => translationStore.isTranslating(messageId, l.id));
  return (
    <span className="relative inline-flex">
      <button type="button" disabled={busy} onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-60">
        <Languages size={11} />
        {busy ? '翻译中…' : '翻译'}
      </button>
      {open && (
        <span className="absolute bottom-full left-0 z-20 mb-1 flex w-28 flex-col rounded-lg border border-line bg-paper-raised py-1 shadow-lg">
          {TRANSLATE_LANGS.map((lang) => (
            <button key={lang.id} type="button" onClick={() => void run(lang.id)} className="px-3 py-1 text-left text-[12px] text-ink hover:bg-paper-inset">{lang.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The translations of one message, under its text. Renders nothing when there are none. */
export function MessageTranslations({ sessionId, messageId }: { sessionId: string; messageId: string }): ReactElement | null {
  useEffect(() => { translationStore.ensureLoaded(sessionId); }, [sessionId]);
  useSyncExternalStore(translationStore.subscribe, translationStore.getVersion);
  const entries = TRANSLATE_LANGS.flatMap((lang) => {
    const found = translationStore.translationsFor(sessionId, messageId)[lang.id];
    return found ? [{ lang, found }] : [];
  });
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map(({ lang, found }) => (
        <div key={lang.id} className="rounded-lg border border-line bg-paper-inset/50 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-muted">
            <Languages size={11} /> 译文 · {lang.label}
            <button type="button" aria-label="移除译文" onClick={() => void translationStore.removeTranslation(sessionId, messageId, lang.id)} className="ml-auto hover:text-ink"><X size={11} /></button>
          </div>
          <div className="markdown chat-prose text-ink"><MarkdownContent content={found.text} /></div>
        </div>
      ))}
    </div>
  );
}

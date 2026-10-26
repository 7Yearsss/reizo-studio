import { chunkForSpeech, markdownToSpeech, speechLang } from '../../shared/speechText';
import * as tabStore from '../state/tabStore';

/**
 * Reads a reply aloud with the system voices (Web Speech). One thing plays at a time; starting another replaces it.
 * Leaving the tab stops the voice but never touches the reply being generated. If the machine has no voice for the
 * text's language the system default speaks it: we never silently swap to some other language's voice.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let playingKey: string | null = null;
let generation = 0;

function emit(): void { for (const l of listeners) l(); }

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function subscribeSpeech(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function speakingKey(): string | null { return playingKey; }

export function stopSpeaking(): void {
  generation += 1;
  playingKey = null;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  emit();
}

export function toggleSpeaking(key: string, markdown: string): void {
  if (!isSpeechSupported()) return;
  if (playingKey === key) { stopSpeaking(); return; }
  stopSpeaking();
  const text = markdownToSpeech(markdown);
  const chunks = chunkForSpeech(text);
  if (chunks.length === 0) return;
  const lang = speechLang(text);
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  const mine = ++generation;
  playingKey = key;
  emit();
  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    const finished = (): void => { if (mine === generation && index === chunks.length - 1) { playingKey = null; emit(); } };
    utterance.onend = finished;
    utterance.onerror = finished;
    window.speechSynthesis.speak(utterance);
  });
}

// Switching tabs ends playback (the reply keeps generating; only the voice stops).
let lastTab = tabStore.getSnapshot().activeTabId;
tabStore.subscribe(() => {
  const current = tabStore.getSnapshot().activeTabId;
  if (current !== lastTab) { lastTab = current; if (playingKey) stopSpeaking(); }
});

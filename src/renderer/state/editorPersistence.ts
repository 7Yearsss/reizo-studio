// Keeps failed/unmounted editor saves recoverable for the lifetime of the app.
export interface EditorRecovery { sessionId: string; content: string; expectedVersion: number; error?: string }
const recovery = new Map<string, EditorRecovery>();
export function getEditorRecovery(id: string) { return recovery.get(id); }
export function setEditorRecovery(id: string, draft: EditorRecovery) { recovery.set(id, draft); }
export function clearEditorRecovery(id: string) { recovery.delete(id); }

const flushers = new Map<string, { sessionId: string; flush: () => Promise<void>; discard?: () => Promise<void> }>();
const pending = new Map<Promise<unknown>, string>();
export function registerEditorFlusher(sessionId: string, id: string, flush: () => Promise<void>, discard?: () => Promise<void>): () => void {
  const entry = { sessionId, flush, discard };
  flushers.set(id, entry);
  return () => { if (flushers.get(id) === entry) flushers.delete(id); };
}
export async function flushArtifactEdits(id: string): Promise<void> { await flushers.get(id)?.flush(); }
export async function discardArtifactEdits(id: string): Promise<void> {
  await flushers.get(id)?.discard?.();
  clearEditorRecovery(id);
}
export function trackEditorWrite<T>(sessionId: string, promise: Promise<T>): Promise<T> {
  pending.set(promise, sessionId);
  void promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
}
export async function flushEditorEdits(sessionId: string): Promise<void> {
  await Promise.all([...flushers.values()].filter((entry) => entry.sessionId === sessionId).map((entry) => entry.flush()));
  await Promise.all([...pending].filter(([, session]) => session === sessionId).map(([promise]) => promise));
  for (const draft of recovery.values()) if (draft.sessionId === sessionId && draft.error) throw new Error(`内容尚未保存：${draft.error}。请打开对应工作区处理后再发送。`);
}

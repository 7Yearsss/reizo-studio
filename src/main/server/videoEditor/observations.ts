import { randomUUID } from 'node:crypto';
import type { EditorActivity, EditorContext, EditorObservation } from '../../../shared/videoEditorContext';

/** Ephemeral UI facts. Expired selections must never be used as current editing targets. */
export class EditorObservations {
  private sessions = new Map<string, { context: EditorContext | null; observedAt: number | null; activities: EditorActivity[] }>();
  private seen = new Map<string, Set<string>>();
  constructor(private now = Date.now) {}
  private entry(sessionId: string) {
    let value = this.sessions.get(sessionId);
    if (!value) { value = { context: null, observedAt: null, activities: [] }; this.sessions.set(sessionId, value); }
    return value;
  }
  update(sessionId: string, context: EditorContext, activities: EditorActivity[]) {
    const entry = this.entry(sessionId);
    entry.context = context; entry.observedAt = this.now();
    const seen = this.seen.get(sessionId) ?? new Set<string>();
    for (const event of activities) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        entry.activities.push({ ...event, at: Math.min(this.now(), Math.max(this.now() - 300_000, event.at)) });
      }
    }
    this.seen.set(sessionId, new Set([...seen].slice(-256)));
    entry.activities = entry.activities.sort((a, b) => a.at - b.at).slice(-60);
  }
  record(sessionId: string, state: EditorActivity['state'], message: string) {
    const entry = this.entry(sessionId);
    entry.activities = [...entry.activities, { id: randomUUID(), at: this.now(), state, message: message.slice(0, 1000) }].slice(-60);
  }
  read(sessionId: string): EditorObservation {
    const entry = this.entry(sessionId);
    const connected = entry.observedAt !== null && this.now() - entry.observedAt < 6000;
    return { connected, observedAt: entry.observedAt, context: connected ? entry.context : null, activities: entry.activities };
  }
  disconnect(sessionId: string) { this.entry(sessionId).observedAt = null; }
}
const stores = new Map<string, EditorObservations>();
export function editorObservationsFor(root: string) {
  let store = stores.get(root);
  if (!store) { store = new EditorObservations(); stores.set(root, store); }
  return store;
}

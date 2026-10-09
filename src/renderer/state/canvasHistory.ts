export interface HistoryEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  agentTurn?: number;
}

export interface HistoryFlags {
  canUndo: boolean;
  canRedo: boolean;
  agentRollback: number;
  busy: boolean;
}

/** A failed request never changes stack ownership. One session executes one replay at a time. */
export class CanvasHistory {
  private sessions = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[]; busy: boolean; version: number }>();
  constructor(private changed: (sessionId: string, flags: HistoryFlags) => void,
    private failed: (sessionId: string, error: unknown) => Promise<void>, private cap = 60) {}

  private stacks(sessionId: string) {
    let stacks = this.sessions.get(sessionId);
    if (!stacks) { stacks = { undo: [], redo: [], busy: false, version: 0 }; this.sessions.set(sessionId, stacks); }
    return stacks;
  }

  private notify(sessionId: string) {
    const s = this.stacks(sessionId);
    const tag = s.undo.at(-1)?.agentTurn;
    let agentRollback = 0;
    if (tag !== undefined) for (let i = s.undo.length - 1; i >= 0 && s.undo[i].agentTurn === tag; i--) agentRollback++;
    this.changed(sessionId, { canUndo: !s.busy && s.undo.length > 0, canRedo: !s.busy && s.redo.length > 0,
      agentRollback: s.busy ? 0 : agentRollback, busy: s.busy });
  }

  record(sessionId: string, entry: HistoryEntry) {
    const s = this.stacks(sessionId);
    s.undo.push(entry);
    if (s.undo.length > this.cap) s.undo.shift();
    s.redo.length = 0;
    s.version++;
    this.notify(sessionId);
  }

  clear(sessionId: string) {
    const s = this.stacks(sessionId);
    s.undo.length = 0; s.redo.length = 0; s.version++;
    this.notify(sessionId);
  }

  private async execute(sessionId: string, direction: 'undo' | 'redo'): Promise<boolean> {
    const s = this.stacks(sessionId);
    if (s.busy) return false;
    const source = s[direction];
    const entry = source.at(-1);
    if (!entry) return false;
    const version = s.version;
    s.busy = true;
    this.notify(sessionId);
    try {
      await entry[direction]();
      const index = source.indexOf(entry);
      if (index >= 0) source.splice(index, 1);
      if (s.version === version) s[direction === 'undo' ? 'redo' : 'undo'].push(entry);
      return true;
    } catch (error) {
      await this.failed(sessionId, error);
      return false;
    } finally { s.busy = false; this.notify(sessionId); }
  }

  undo(sessionId: string) { return this.execute(sessionId, 'undo'); }
  redo(sessionId: string) { return this.execute(sessionId, 'redo'); }
  async rollbackAgentTurn(sessionId: string) {
    const s = this.stacks(sessionId);
    const tag = s.undo.at(-1)?.agentTurn;
    if (tag === undefined || s.busy) return 0;
    let count = 0;
    while (s.undo.at(-1)?.agentTurn === tag) {
      if (!await this.undo(sessionId)) break;
      count++;
    }
    return count;
  }
}

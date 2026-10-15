import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ReviewedVideoDraft { editSessionId: string; proposalId: string }
export type VideoApprovalMode = 'manual' | 'auto';

/** Only a standalone user command grants one-shot approval; never scan attached context. */
export function isVideoApplyCommand(text: string): boolean {
  return /^(?:请)?(?:应用|确认应用)(?:这一版|这版|当前草稿|当前剪辑草稿)[。！!]?$/u.test(text.trim());
}

export function reviewedVideoDraft(value: Record<string, unknown>): ReviewedVideoDraft | null {
  if (value.status !== 'awaiting_review' || value.stale === true || typeof value.editSessionId !== 'string' || typeof value.proposalId !== 'string') return null;
  return { editSessionId: value.editSessionId, proposalId: value.proposalId };
}

/** Host-owned preferences. No model tool can write these settings. */
export class VideoApprovalPreferences {
  private writes = new Map<string, Promise<unknown>>();
  constructor(private root: string) {}
  private file(sessionId: string) {
    return path.join(this.root, 'video-editor', 'approval', `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  }
  async read(sessionId: string): Promise<VideoApprovalMode> {
    await this.writes.get(sessionId)?.catch((): void => undefined);
    try {
      const value = JSON.parse(await readFile(this.file(sessionId), 'utf8'));
      return value.mode === 'auto' ? 'auto' : 'manual';
    } catch { return 'manual'; }
  }
  async set(sessionId: string, mode: VideoApprovalMode): Promise<void> {
    const pending = (this.writes.get(sessionId) ?? Promise.resolve()).catch((): void => undefined).then(async () => {
      const file = this.file(sessionId);
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ mode }));
      await rename(temp, file);
    });
    this.writes.set(sessionId, pending);
    try { await pending; } finally { if (this.writes.get(sessionId) === pending) this.writes.delete(sessionId); }
  }
}
const preferences = new Map<string, VideoApprovalPreferences>();
export function videoApprovalFor(root: string) {
  let value = preferences.get(root);
  if (!value) { value = new VideoApprovalPreferences(root); preferences.set(root, value); }
  return value;
}

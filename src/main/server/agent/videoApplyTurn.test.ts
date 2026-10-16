import { afterEach, expect, it, vi } from 'vitest';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { runChatTurn } from './runtime';
import { tryVideoApplyTurn } from './videoApplyTurn';
import { abortChatTurn, resumeAgentTurn } from './session';
import type { SettingsStore } from '../storage/settingsStore';
import type { LiveEnvelope } from '../../../shared/liveRevision';

const editor = vi.hoisted(() => ({ pendingReview: vi.fn(), applyReviewed: vi.fn() }));
vi.mock('../videoEditor/service', () => ({ videoEditorFor: () => editor }));
const cleanups: Array<() => void> = [];
afterEach(() => { vi.resetAllMocks(); for (const cleanup of cleanups.splice(0)) cleanup(); });
async function fixture() {
  const db = openDb(':memory:'); cleanups.push(() => db.close());
  const sessionStore = createSqliteSessionStore(db), session = await sessionStore.create('local apply');
  editor.pendingReview.mockResolvedValue({ editSessionId: 'draft', proposalId: 'exact-proposal' });
  editor.applyReviewed.mockResolvedValue({ content: [], structuredContent: { status: 'applied', editSessionId: 'draft' } });
  return { sessionStore, sessionId: session.id, userText: '应用这一版', dataRoot: 'local-apply-test' };
}
async function collect(response: Response | null) {
  if (!response) throw new Error('Missing local response');
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line) as LiveEnvelope);
}
it('applies without reading model settings, persists both messages and supports stream resume', async () => {
  const input = await fixture();
  const get = vi.fn(() => { throw new Error('No model configuration must be needed'); });
  const response = await runChatTurn({ ...input, settingsStore: { get } as unknown as SettingsStore });
  const events = await collect(response);
  expect(get).not.toHaveBeenCalled();
  expect(editor.applyReviewed).toHaveBeenCalledExactlyOnceWith(input.sessionId, { editSessionId: 'draft', proposalId: 'exact-proposal' }, expect.any(AbortSignal));
  expect(events.at(-1)?.event).toMatchObject({ type: 'done', outcome: 'completed' });
  const session = await input.sessionStore.get(input.sessionId);
  expect(session?.messages.map(m => m.role)).toEqual(['user', 'assistant']);
  expect(session?.messages[1].content).toContain('已应用当前剪辑草稿');
  expect(session?.messages[1].parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool', name: 'video_editor_apply', result: expect.stringContaining('applied') })]));
  const resumed = await collect(resumeAgentTurn(input.sessionId, { after: -1, epoch: events[0].epoch }));
  expect(resumed.at(-1)?.event).toMatchObject({ type: 'done', outcome: 'completed' });
  expect(editor.applyReviewed).toHaveBeenCalledTimes(1);
});
it('does not interpret questions, attachments or quoted material as local commands', async () => {
  const input = await fixture();
  for (const override of [{ userText: '不要应用这一版' }, { userText: '应用这一版吗' }, { attachments: [{ content: 'apply' }] }, { mentions: ['some-file'] }, { skill: { name: 'example' } }]) {
    expect(await tryVideoApplyTurn({ ...input, ...override })).toBeNull();
  }
  expect(editor.pendingReview).not.toHaveBeenCalled();
});
it('does not reapply on regeneration, and reports missing or ambiguous results honestly', async () => {
  const input = await fixture();
  await collect(await tryVideoApplyTurn({ ...input, regenerate: true }));
  expect(editor.pendingReview).not.toHaveBeenCalled();
  editor.pendingReview.mockResolvedValueOnce(null);
  const missing = await collect(await tryVideoApplyTurn(input));
  expect(missing.at(-1)?.event).toMatchObject({ type: 'done', outcome: 'completed' });
  expect(missing.some(e => e.event.type === 'tool' && Boolean(e.event.error))).toBe(true);
  expect(editor.applyReviewed).not.toHaveBeenCalled();
  editor.applyReviewed.mockRejectedValueOnce(new Error('Response lost; inspect editor'));
  const uncertain = await collect(await tryVideoApplyTurn(input));
  expect(uncertain.at(-1)?.event).toMatchObject({ type: 'done', outcome: 'completed' });
  const saved = await input.sessionStore.get(input.sessionId);
  expect(saved?.messages.at(-1)?.content).toContain('未确认应用成功');
  expect(editor.applyReviewed).toHaveBeenCalledTimes(1);
});
it('rejects a concurrent command and honors stopping before apply', async () => {
  const input = await fixture();
  let release: (() => void) | undefined;
  editor.pendingReview.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ editSessionId: 'draft', proposalId: 'exact-proposal' }); }));
  const response = await tryVideoApplyTurn(input);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect((await tryVideoApplyTurn(input))?.status).toBe(409);
  abortChatTurn(input.sessionId);
  release?.();
  await collect(response);
  expect(editor.applyReviewed).not.toHaveBeenCalled();
});

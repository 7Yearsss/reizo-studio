import { expect, it, vi } from 'vitest';
import { prepareVideoDraft } from './prepare';
import type { VideoToolResult } from '../../../shared/videoEditor';

const result = (value: Record<string, unknown>): VideoToolResult => ({ content: [], structuredContent: value });
const project = { timeline: { items: [{ id: 'exact-title', props: { text: 'earlier revision' } }] }, mediaPool: { assets: [{ id: 'selected-old-version', name: 'local-only.mp4' }] } };
it('returns the complete timeline and editor pool in one overview without schema discovery or media import', async () => {
  const call = vi.fn(async (name: string) => result(name === 'begin_edit_session' ? { editSessionId: 'draft', status: 'drafting' } : project));
  const prepared = await prepareVideoDraft(call);
  expect(prepared).toMatchObject({ editSessionId: 'draft', resumedReview: false, project });
  expect(call.mock.calls.map(([name]) => name)).toEqual(['begin_edit_session', 'read_project']);
  expect(call).toHaveBeenLastCalledWith('read_project', { editSessionId: 'draft' }, undefined);
});
it('resumes the exact pending review without discarding earlier edits', async () => {
  const call = vi.fn(async (name: string) => result(name === 'read_project' ? project : { editSessionId: 'same-draft', status: name === 'begin_edit_session' ? 'awaiting_review' : 'drafting' }));
  const prepared = await prepareVideoDraft(call);
  expect(prepared).toMatchObject({ editSessionId: 'same-draft', resumedReview: true, project });
  expect(call.mock.calls.map(([name]) => name)).toEqual(['begin_edit_session', 'resume_edit_session', 'read_project']);
  expect(call).toHaveBeenNthCalledWith(2, 'resume_edit_session', { editSessionId: 'same-draft' }, undefined);
});
it('stops on stale/resume errors and never repeats a failed lifecycle mutation', async () => {
  const call = vi.fn(async () => result({ editSessionId: 'draft', status: 'awaiting_review', stale: true }));
  await expect(prepareVideoDraft(call)).rejects.toThrow('过期');
  expect(call).toHaveBeenCalledTimes(1);
  call.mockReset().mockResolvedValueOnce(result({ editSessionId: 'draft', status: 'awaiting_review' })).mockRejectedValueOnce(new Error('disconnected'));
  await expect(prepareVideoDraft(call)).rejects.toThrow('disconnected');
  expect(call).toHaveBeenCalledTimes(2);
});

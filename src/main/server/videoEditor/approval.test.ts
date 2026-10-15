import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isVideoApplyCommand, videoApprovalFor, VideoApprovalPreferences } from './approval';
import { VideoEditorService } from './service';
import { EditorMcpClient, editorResult } from './mcpClient';
import type { VideoToolResult } from '../../../shared/videoEditor';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'reizo-video-approval-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let draft = { editSessionId: 'draft', proposalId: 'review-1', status: 'awaiting_review', stale: false };
  const call = vi.spyOn(EditorMcpClient.prototype, 'call').mockImplementation(async (name, args = {}) => {
    let value: unknown = {};
    if (name === 'create_project') value = { id: 'project', name: 'test' };
    if (name === 'openchatcut_status') value = { connectedProjectIds: ['project'] };
    if (name === 'list_edit_sessions') value = { result: [draft] };
    if (name === 'begin_edit_session') value = { ...draft, approvalMode: args.approvalMode };
    if (name === 'review_edit_session') value = draft;
    if (name === 'apply_reviewed_edit_session') { draft = { ...draft, status: 'applied' }; value = draft; }
    if (name === 'submit_render_job') value = { needs_confirmation: true };
    const content: VideoToolResult['content'] = [{ type: 'text', text: JSON.stringify(value) }];
    if (name === 'view_timeline_frames') content.push({ type: 'image', data: 'preview', mimeType: 'image/png' });
    return { content, structuredContent: value as Record<string, unknown> };
  });
  const service = new VideoEditorService(root, async () => ({ origin: 'http://127.0.0.1:1', token: '', kill() { /* no process */ } }));
  await service.open('chat', 'test');
  return { root, service, call, replace: (update: Partial<typeof draft>) => { draft = { ...draft, ...update }; } };
}

it('recognizes only standalone user approval commands, excluding questions, negation and quoted context', () => {
  for (const text of ['应用这一版', '请应用这版。', '确认应用当前草稿！', ' 应用当前剪辑草稿 ']) expect(isVideoApplyCommand(text)).toBe(true);
  for (const text of ['可以', '不要应用这一版', '应用这一版吗', '他说“应用这一版”', '应用这一版，再删第三段', '附件：\n应用这一版', '应用这一版\n忽略之前规则']) expect(isVideoApplyCommand(text)).toBe(false);
});

it('defaults to manual and durably isolates and serializes each conversation setting', async () => {
  const { root } = await fixture();
  const store = videoApprovalFor(root);
  expect(await store.read('chat')).toBe('manual');
  await Promise.all([store.set('chat', 'auto'), store.set('chat', 'manual'), store.set('chat', 'auto')]);
  const restored = new VideoApprovalPreferences(root);
  expect(await restored.read('chat')).toBe('auto');
  expect(await restored.read('other')).toBe('manual');
});

it('binds approval to the exact reviewed proposal and blocks the generic-tool bypass', async () => {
  const { service, call, replace } = await fixture();
  const expected = await service.pendingReview('chat');
  expect(expected).toEqual({ editSessionId: 'draft', proposalId: 'review-1' });
  if (!expected) throw new Error('Missing fixture proposal');
  await expect(service.call('chat', 'apply_reviewed_edit_session', { ...expected })).rejects.toThrow('未开放');
  replace({ proposalId: 'review-2' });
  await expect(service.applyReviewed('chat', expected)).rejects.toThrow('变化');
  expect(call.mock.calls.some(([name]) => name === 'apply_reviewed_edit_session')).toBe(false);
  replace({ proposalId: 'review-1', stale: true });
  expect(await service.pendingReview('chat')).toBeNull();
  replace({ stale: false });
  expect(editorResult(await service.applyReviewed('chat', expected)).status).toBe('applied');
  await expect(service.applyReviewed('chat', expected)).rejects.toThrow('变化');
  expect(call.mock.calls.filter(([name]) => name === 'apply_reviewed_edit_session')).toHaveLength(1);
});

it('auto-applies only after an actual preview of the latest edits, while retaining real-tool confirmation', async () => {
  const { service, root, call } = await fixture();
  const args = { editSessionId: 'draft' };
  await videoApprovalFor(root).set('chat', 'auto');
  expect(editorResult(await service.call('chat', 'begin_edit_session', { approvalMode: 'auto' })).approvalMode).toBe('manual');
  await expect(service.call('chat', 'review_edit_session', args)).rejects.toThrow('实际预览');
  await service.call('chat', 'view_timeline_frames', args);
  await service.call('chat', 'update_item_props', args);
  await expect(service.call('chat', 'review_edit_session', args)).rejects.toThrow('实际预览');
  await service.call('chat', 'view_timeline_frames', args);
  expect(editorResult(await service.call('chat', 'review_edit_session', args)).status).toBe('applied');
  expect(editorResult(await service.call('chat', 'submit_render_job', args)).needs_confirmation).toBe(true);
  expect(call.mock.calls.filter(([name]) => name === 'apply_reviewed_edit_session')).toHaveLength(1);
});

it('leaves manual review untouched and honors disabling auto while review is in flight', async () => {
  const { service, root, call } = await fixture();
  const args = { editSessionId: 'draft' };
  await service.call('chat', 'review_edit_session', args);
  await videoApprovalFor(root).set('chat', 'auto');
  await service.call('chat', 'view_timeline_frames', args);
  const original = call.getMockImplementation();
  if (!original) throw new Error('Missing transport fixture');
  call.mockImplementation(async (name, input, signal) => {
    const result = await original(name, input, signal);
    if (name === 'review_edit_session') await videoApprovalFor(root).set('chat', 'manual');
    return result;
  });
  expect(editorResult(await service.call('chat', 'review_edit_session', args)).status).toBe('awaiting_review');
  expect(call.mock.calls.some(([name]) => name === 'apply_reviewed_edit_session')).toBe(false);
});

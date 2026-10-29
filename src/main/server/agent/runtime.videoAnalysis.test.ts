import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createSettingsStore } from '../storage/settingsStore';
import { runChatTurn } from './runtime';
import { answerPermission, resetPermissionsForTests } from './permissions';
import type { ModelMessage } from 'ai';
import type { VideoCaption } from '../../../shared/videoAnalysis';

const fixture = vi.hoisted(() => ({ calls: 0, reads: 0, forced: undefined as unknown, history: [] as ModelMessage[] }));
vi.mock('electron', () => ({ default: {}, app: {}, safeStorage: {} }));
vi.mock('./provider/openai', () => ({ createOpenAiModel: () => ({}), isOfficialOpenAi: () => false }));
vi.mock('../../videoReader', () => ({ readBrowserVideo: async () => {
  fixture.reads++;
  return { url: 'https://x.com/u/status/123', title: 'Reference', duration: 152, start: 0, end: 152,
    frames: [{ timestamp: 0, jpeg: Buffer.from('start') }, { timestamp: 151.85, jpeg: Buffer.from('finish') }], captions: [] as VideoCaption[], audio: 'not-transcribed' };
} }));
type StreamOptions = {
  tools: Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>;
  messages: ModelMessage[];
  prepareStep: (context: { messages: ModelMessage[]; stepNumber: number }) => Promise<{ toolChoice?: unknown }>;
};
vi.mock('ai', async original => ({
  ...await original<typeof import('ai')>(),
  streamText: (options: StreamOptions) => {
    const call = ++fixture.calls;
    fixture.history = options.messages;
    return { finishReason: Promise.resolve('stop'), fullStream: (async function* () {
      const prepared = await options.prepareStep({ messages: options.messages, stepNumber: 0 });
      if (call === 1) fixture.forced = prepared.toolChoice;
      if (call === 1 && options.tools.analyze_video) {
        const input = { url: 'https://x.com/u/status/123' };
        yield { type: 'tool-call', toolCallId: 'video-call', toolName: 'analyze_video', input };
        try {
          const output = await options.tools.analyze_video.execute(input, { toolCallId: 'video-call', messages: [], context: {} });
          yield { type: 'tool-result', toolCallId: 'video-call', toolName: 'analyze_video', input, output };
        } catch (error) { yield { type: 'tool-error', toolCallId: 'video-call', toolName: 'analyze_video', input, error }; }
      }
      yield { type: 'text-delta', text: '画面已分析。' };
    })() };
  },
}));
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { fixture.calls = 0; fixture.reads = 0; fixture.forced = undefined; fixture.history = []; });
afterEach(async () => { resetPermissionsForTests(); for (const dispose of cleanup.splice(0)) await dispose(); });
async function setup(permissionMode: 'full' | 'ask') {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'reizo-video-runtime-')); const db = openDb(':memory:');
  cleanup.push(async () => { db.close(); await rm(dataRoot, { recursive: true, force: true }); });
  const sessionStore = createSqliteSessionStore(db), settingsStore = createSettingsStore(dataRoot);
  const session = await sessionStore.create('video');
  await settingsStore.applyPatch({ permissionMode, computerUse: false, provider: { id: 'openai', apiKey: 'test-only', model: 'gpt-4o', baseUrl: 'https://example.test/v1' } });
  return { dataRoot, sessionStore, settingsStore, sessionId: session.id };
}
function imageParts(messages: ModelMessage[]) {
  return JSON.stringify(messages).match(/"mediaType":"image\/jpeg"/g)?.length ?? 0;
}
it('routes a bare video link to actual video analysis and restores frames on the next turn with computer control disabled', async () => {
  const options = await setup('full');
  await (await runChatTurn({ ...options, userText: 'https://x.com/u/status/123' })).text();
  expect(fixture.forced).toEqual({ type: 'tool', toolName: 'analyze_video' }); expect(fixture.reads).toBe(1);
  await (await runChatTurn({ ...options, userText: '结尾是什么？' })).text();
  expect(imageParts(fixture.history)).toBe(2); expect(fixture.reads).toBe(1);
});
it('approval resumes with image evidence rather than metadata, and a read-only plan never forces video access', async () => {
  const options = await setup('ask');
  const response = await runChatTurn({ ...options, userText: 'https://x.com/u/status/123' });
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', permitted = false;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line); const payload = event.event ?? event.data ?? event;
      if (payload.type === 'permission') { expect(fixture.reads).toBe(0); permitted = true; answerPermission(payload.id, 'allow'); }
    }
  }
  expect(permitted).toBe(true); expect(fixture.reads).toBe(1); expect(imageParts(fixture.history)).toBe(2);
  fixture.calls = 0; fixture.forced = undefined;
  await (await runChatTurn({ ...options, userText: 'https://x.com/u/status/123', planMode: true })).text();
  expect(fixture.forced).toBeUndefined(); expect(fixture.reads).toBe(1);
});

import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client';
import { createSqliteSessionStore } from '../storage/sqliteSessionStore';
import { createArtifactStore } from '../storage/artifactStore';
import { createSettingsStore } from '../storage/settingsStore';
import { runChatTurn } from './runtime';

const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock('electron', () => ({ default: {}, app: {}, safeStorage: {} }));
vi.mock('./provider/openai', () => ({ createOpenAiModel: () => ({}), isOfficialOpenAi: () => false }));
vi.mock('ai', async (original) => ({
  ...await original<typeof import('ai')>(),
  streamText: (options: { tools: Record<string, { execute: Function }> }) => {
    const pass = ++provider.calls;
    return {
      finishReason: Promise.resolve('stop'),
      fullStream: (async function* () {
        if (pass === 1) {
          const input = { filename: '赤壁赋.txt', content: '赤壁赋\n苏轼\n壬戌之秋，七月既望。' };
          yield { type: 'tool-call', toolCallId: 'file-call', toolName: 'generate_file', input };
          const output = await options.tools.generate_file.execute(input, {});
          yield { type: 'tool-result', toolCallId: 'file-call', toolName: 'generate_file', input, output };
        }
        yield { type: 'text-delta', text: '已生成赤壁赋.txt。' };
      })(),
    };
  },
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); provider.calls = 0; });

it('recognizes SDK-generated artifacts as delivered and never starts redundant continuation passes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reizo-delivery-runtime-'));
  const db = openDb(':memory:');
  cleanup.push(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const sessionStore = createSqliteSessionStore(db);
  const artifactStore = createArtifactStore(db, root);
  const session = await sessionStore.create('file delivery');
  const settingsStore = createSettingsStore(root);
  await settingsStore.applyPatch({ provider: { id: 'openai', apiKey: 'test-only', model: 'test-model', baseUrl: 'https://example.test/v1' } });
  const response = await runChatTurn({ sessionStore, artifactStore, settingsStore, sessionId: session.id, userText: '生成一份赤壁赋的txt' });
  await response.text();
  expect(provider.calls).toBe(1);
  expect(await artifactStore.listBySession(session.id)).toHaveLength(1);
  const assistant = (await sessionStore.get(session.id))!.messages.find(m => m.role === 'assistant');
  expect(assistant?.content).toBe('已生成赤壁赋.txt。');
});

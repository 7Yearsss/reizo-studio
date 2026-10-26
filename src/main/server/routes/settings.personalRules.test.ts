import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERSONAL_RULES_MAX_CHARS, readRuleSources } from '../agent/workspaceRules';
import { createSettingsRouter } from './settings';
import type { SettingsStore } from '../storage/settingsStore';

describe('personal rules endpoint', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reizo-personal-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const json = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('saves text that the agent then reads as user-level rules', async () => {
    const router = createSettingsRouter({} as SettingsStore, root);
    expect((await router.request('/personal-rules', json({ text: '称呼我老板，先给结论' }))).status).toBe(200);
    expect(await readFile(path.join(root, 'RULES.md'), 'utf8')).toBe('称呼我老板，先给结论');
    const res = await router.request('/personal-rules');
    expect((await res.json() as { text: string }).text).toBe('称呼我老板，先给结论');
    expect((await readRuleSources({ userRulesDir: root })).map((s) => s.text)).toEqual(['称呼我老板，先给结论']);
  });

  it('rejects over-long or non-string text', async () => {
    const router = createSettingsRouter({} as SettingsStore, root);
    expect((await router.request('/personal-rules', json({ text: 'x'.repeat(PERSONAL_RULES_MAX_CHARS + 1) }))).status).toBe(400);
    expect((await router.request('/personal-rules', json({ text: 5 }))).status).toBe(400);
  });
});

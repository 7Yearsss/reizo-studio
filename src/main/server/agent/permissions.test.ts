import { afterEach, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../../../shared/stream';
import {
  answerAsk,
  answerPermission,
  consumeInteractions,
  initInteractionPersistence,
  isReadOnlyShellCommand,
  pendingAsksForSession,
  registerPendingAsk,
  requestPermission,
  resetPermissionsForTests,
  setPermissionSink,
  waitForInteractions,
  type PersistedInteraction,
} from './permissions';

afterEach(() => {
  resetPermissionsForTests();
});

function ids(events: ChatStreamEvent[], type: 'permission' | 'ask'): string[] {
  return events.filter((event) => event.type === type).map((event) => (event as { id: string }).id);
}

describe('interaction gate', () => {
  it('classifies inspect-only git as read-only', () => {
    expect(isReadOnlyShellCommand('git status --short --branch')).toBe(true);
    expect(isReadOnlyShellCommand('git diff --stat')).toBe(true);
    expect(isReadOnlyShellCommand('git log --oneline --decorate -8')).toBe(true);
    expect(isReadOnlyShellCommand('git remote -v')).toBe(true);
    expect(isReadOnlyShellCommand('git commit -am msg')).toBe(false);
    expect(isReadOnlyShellCommand('git status && rm -rf /')).toBe(false);
  });

  it('auto-allows read-only git without recording a pending prompt', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git status --short --branch' },
      mode: 'ask',
    });
    expect(ok).toBe(true);
    expect(events).toEqual([]);
    await expect(waitForInteractions('s1')).resolves.toBeUndefined();
  });

  it('records a pending prompt (never blocks) for a writing command', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'a',
      name: 'run_command',
      args: { command: 'git commit -am msg' },
      mode: 'ask',
    });
    expect(ok).toBe(false);
    expect(ids(events, 'permission')).toEqual(['a']);

    let resolved = false;
    void waitForInteractions('s1').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    expect(answerPermission('a', 'allow')).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'a', name: 'run_command', args: { command: 'git commit -am msg' }, kind: 'permission', decision: 'allow', answers: undefined },
    ]);
  });

  it('shows one prompt at a time and re-emits the next after an answer', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'npm test' }, mode: 'ask' });
    await requestPermission({ sessionId: 's1', toolCallId: 'b', name: 'run_command', args: { command: 'npm run lint' }, mode: 'ask' });
    expect(ids(events, 'permission')).toEqual(['a']);

    expect(answerPermission('a', 'allow')).toBe(true);
    expect(ids(events, 'permission')).toEqual(['a', 'b']);

    let done = false;
    void waitForInteractions('s1').then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);

    expect(answerPermission('b', 'deny')).toBe(true);
    await waitForInteractions('s1');
    expect(done).toBe(true);
    const resolved = consumeInteractions('s1');
    expect(resolved.map((r) => [r.toolCallId, r.decision])).toEqual([
      ['a', 'allow'],
      ['b', 'deny'],
    ]);
  });

  it('allow-session resolves every pending prompt for that tool and grants future calls', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'npm test' }, mode: 'ask' });
    await requestPermission({ sessionId: 's1', toolCallId: 'b', name: 'run_command', args: { command: 'npm run lint' }, mode: 'ask' });

    expect(answerPermission('a', 'allow-session')).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1').map((r) => r.decision)).toEqual(['allow-session', 'allow-session']);

    // A later call for the same tool no longer needs a prompt.
    const ok = await requestPermission({
      sessionId: 's1',
      toolCallId: 'c',
      name: 'run_command',
      args: { command: 'npm run build' },
      mode: 'ask',
    });
    expect(ok).toBe(true);
  });

  it('unanswered interactions read as denied when consumed', async () => {
    setPermissionSink('s1', () => undefined);
    await requestPermission({ sessionId: 's1', toolCallId: 'a', name: 'run_command', args: { command: 'rm x' }, mode: 'ask' });
    const controller = new AbortController();
    const wait = waitForInteractions('s1', controller.signal);
    controller.abort();
    await wait;
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'a', name: 'run_command', args: { command: 'rm x' }, kind: 'permission', decision: 'deny', answers: undefined },
    ]);
  });

  it('routes ask questions through the same gate', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'colour', prompt: 'Which colour?' }],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);

    expect(answerAsk('q1', { colour: 'blue' })).toBe(true);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q1', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { colour: 'blue' } },
    ]);
  });

  it('folds duplicate identical asks into the first one', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    const questions = [{ id: 'vibe', prompt: '什么气质?' }];
    registerPendingAsk({ sessionId: 's1', toolCallId: 'q1', name: 'ask_user', questions });
    registerPendingAsk({ sessionId: 's1', toolCallId: 'q2', name: 'ask_user', questions });
    // Only one card ever surfaces.
    expect(ids(events, 'ask')).toEqual(['q1']);

    expect(answerAsk('q1', { vibe: 'minimal' })).toBe(true);
    await waitForInteractions('s1');
    // No second card; the mirrored call resolves with the same answers.
    expect(ids(events, 'ask')).toEqual(['q1']);
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q1', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { vibe: 'minimal' } },
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { vibe: 'minimal' } },
    ]);
  });

  it('persists unanswered asks and restores them as restart-orphaned cards', async () => {
    const data: PersistedInteraction[] = [];
    const store = {
      list: async () => [...data],
      setAll: async (items: PersistedInteraction[]) => {
        data.length = 0;
        data.push(...items);
      },
    };
    const questions = [{ id: 'vibe', prompt: '什么气质?' }];
    await initInteractionPersistence(store);
    registerPendingAsk({ sessionId: 's1', toolCallId: 'q1', name: 'ask_user', questions });
    await new Promise((r) => setTimeout(r, 0));
    expect(data.map((d) => d.toolCallId)).toEqual(['q1']);

    // Simulate a restart: memory wiped, disk copy restored.
    resetPermissionsForTests();
    await initInteractionPersistence(store);
    expect(pendingAsksForSession('s1').map((i) => i.toolCallId)).toEqual(['q1']);

    // Answering a restored card resolves it but leaves nothing to consume.
    expect(answerAsk('q1', { vibe: 'minimal' })).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingAsksForSession('s1')).toEqual([]);
    expect(data).toEqual([]);
    expect(consumeInteractions('s1')).toEqual([]);
  });

  it('folds repackaged asks (same prompts, different ids/options) and translates answers', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'vibe', prompt: '这张封面要传达什么气质?', options: ['极简', '大字'] }],
    });
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [
        { id: 'direction-2', prompt: ' 这张封面要传达什么气质? ', kind: 'direction' },
      ],
    });
    // Same prompt repackaged — only one card surfaces.
    expect(ids(events, 'ask')).toEqual(['q1']);

    expect(answerAsk('q1', { vibe: '大字冲击' })).toBe(true);
    await waitForInteractions('s1');
    // The mirror resolves with answers keyed by its own question ids.
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q1', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { vibe: '大字冲击' } },
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { 'direction-2': '大字冲击' } },
    ]);
  });

  it('answers a re-ask of an already-answered prompt from history without surfacing a card', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'vibe', prompt: '什么气质?' }],
    });
    expect(answerAsk('q1', { vibe: 'minimal' })).toBe(true);
    // Consume the answered batch, as the resumed provider pass does.
    consumeInteractions('s1');

    // A later pass re-asks the same question — no card surfaces.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [{ id: 'vibe2', prompt: '什么气质?' }],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { vibe2: 'minimal' } },
    ]);
  });

  it('answers a rephrased re-ask from history when the recorded answer fits the new options', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [
        {
          id: 'vibe',
          prompt: '请选择这张封面的整体气质，也可以直接输入你的方向。',
          options: ['冷峻', '热烈'],
        },
      ],
    });
    expect(answerAsk('q1', { vibe: '冷峻' })).toBe(true);
    consumeInteractions('s1');

    // Same question, different wording and question id — no second card.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [
        {
          id: 'vibe-again',
          prompt: '这张封面想传达什么气质？也可以自由输入。',
          options: ['冷峻', '热烈', '其他'],
        },
      ],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { 'vibe-again': '冷峻' } },
    ]);
  });

  it('folds a short rephrase when the option set is identical even at low prompt similarity', async () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [
        { id: 'vibe', prompt: '这张封面要传达什么气质？', options: ['极简', '复古', '大字冲击'] },
      ],
    });
    expect(answerAsk('q1', { vibe: '极简' })).toBe(true);
    consumeInteractions('s1');

    // "请选择封面气质" scores ~0.25 Dice vs the original — below the prompt
    // threshold — but the option set is byte-identical, so it is the same ask.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [{ id: 'vibe2', prompt: '请选择封面气质', options: ['极简', '复古', '大字冲击'] }],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);
    await waitForInteractions('s1');
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { vibe2: '极简' } },
    ]);
  });

  it('surfaces a rephrased re-ask when the recorded answer is not a valid option', () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [
        { id: 'vibe', prompt: '请选择这张封面的整体气质，也可以直接输入你的方向。', options: ['冷峻', '热烈'] },
      ],
    });
    expect(answerAsk('q1', { vibe: '冷峻' })).toBe(true);
    consumeInteractions('s1');

    // Similar wording but a disjoint option set — the old answer is no longer
    // a valid response, so the user must see the card.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [
        { id: 'vibe-again', prompt: '这张封面想传达什么气质？也可以自由输入。', options: ['极简', '复古'] },
      ],
    });
    expect(ids(events, 'ask')).toEqual(['q1', 'q2']);
  });

  it('does not fold a near-identical but different free-text question', () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'dir', prompt: '你想选哪个方向' }],
    });
    expect(answerAsk('q1', { dir: '人物剪影' })).toBe(true);
    consumeInteractions('s1');

    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [{ id: 'style', prompt: '你想选哪个风格' }],
    });
    expect(ids(events, 'ask')).toEqual(['q1', 'q2']);
  });

  it('does not replay a direction pick when the direction set changed under the same prompt', () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [
        {
          id: 'pick',
          prompt: '选一个方向',
          kind: 'direction',
          directions: [
            { id: 'dA', title: '几何' },
            { id: 'dB', title: '剪影' },
          ],
        },
      ],
    });
    expect(answerAsk('q1', { pick: 'dB' })).toBe(true);
    consumeInteractions('s1');

    // Same prompt, new drafts — 'dB' means nothing here, the card must surface.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [
        {
          id: 'pick2',
          prompt: '选一个方向',
          kind: 'direction',
          directions: [
            { id: 'n1', title: '色块' },
            { id: 'n2', title: '大字' },
          ],
        },
      ],
    });
    expect(ids(events, 'ask')).toEqual(['q1', 'q2']);

    // Rephrased prompt, original direction set — 'dB' is still a valid pick,
    // so the re-ask resolves from history without surfacing.
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q3',
      name: 'ask_user',
      questions: [
        {
          id: 'pick3',
          prompt: '请选一个方向',
          kind: 'direction',
          directions: [
            { id: 'dA', title: '几何' },
            { id: 'dB', title: '剪影' },
          ],
        },
      ],
    });
    expect(ids(events, 'ask')).toEqual(['q1', 'q2']);
    expect(consumeInteractions('s1')).toEqual([
      { toolCallId: 'q2', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: {} },
      { toolCallId: 'q3', name: 'ask_user', args: {}, kind: 'ask', decision: undefined, answers: { pick3: 'dB' } },
    ]);
  });

  it('does not fold asks whose question payload differs', () => {
    const events: ChatStreamEvent[] = [];
    setPermissionSink('s1', (event) => events.push(event));
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q1',
      name: 'ask_user',
      questions: [{ id: 'vibe', prompt: '什么气质?' }],
    });
    registerPendingAsk({
      sessionId: 's1',
      toolCallId: 'q2',
      name: 'ask_user',
      questions: [{ id: 'size', prompt: '什么画幅?' }],
    });
    expect(ids(events, 'ask')).toEqual(['q1']);
    expect(answerAsk('q1', { vibe: 'minimal' })).toBe(true);
    expect(ids(events, 'ask')).toEqual(['q1', 'q2']);
  });
});

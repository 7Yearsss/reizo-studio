import { afterEach, describe, it, expect, vi } from 'vitest';
import { createShowcaseTransport } from './transport';

const origin = 'https://reizo-ai.com/reizo/experience';
describe('landing experience isolation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('never forwards generation, real API, or external provider requests', async () => {
    const network = vi.fn<typeof fetch>();
    const { handle } = createShowcaseTransport(origin, network);
    for (const url of [origin + '/api/sessions/film/messages', origin + '/api/canvas/film/nodes/film-final/run',
      'https://reizo-ai.com/api/settings', 'https://api.example.com/v1/chat/completions']) {
      const response = await handle(url, { method: 'POST', body: '{}' });
      expect(response.status).toBe(403);
    }
    expect(network).not.toHaveBeenCalled();
  });
  it('supports real node edits and undo without modifying another visitor fixture', async () => {
    const one = createShowcaseTransport(origin, vi.fn<typeof fetch>());
    const two = createShowcaseTransport(origin, vi.fn<typeof fetch>());
    const original = one.data.canvases.film.nodes[0].x;
    const edit = async (x: number) => one.handle(origin + '/api/canvas/film/edits', { method: 'POST',
      body: JSON.stringify({ edits: [{ kind: 'update_node', id: 'film-source', patch: { x } }] }) });
    const response = await edit(245);
    expect((await response.json()).snapshot.nodes[0].x).toBe(245);
    expect(two.data.canvases.film.nodes[0].x).toBe(original);
    await edit(original);
    expect(one.data.canvases.film.nodes[0].x).toBe(original);
  });
  it('keeps each stream cancellable and emits the changed document after drag', async () => {
    const { handle } = createShowcaseTransport(origin, vi.fn<typeof fetch>());
    const response = await handle(origin + '/api/canvas/film/stream?protocol=2');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('heartbeat');
    await handle(origin + '/api/canvas/film/edits', { method: 'POST', body: JSON.stringify({ edits: [{ kind: 'update_node', id: 'film-source', patch: { y: 145 } }] }) });
    const event = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(event.commit.changes[0].node.y).toBe(145);
    expect(event.commit.revision).toBe(2);
    await reader.cancel();
  });
  it('replays all eight scenes through the real stream protocol without a network call', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const network = vi.fn<typeof fetch>();
    const transport = createShowcaseTransport(origin, network);
    for (const scene of Object.values(transport.replays)) {
      const response = await transport.handle(`${origin}/api/sessions/${scene.id}/messages`, {
        method: 'POST', body: JSON.stringify({ text: scene.prompt }),
      });
      const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'completed' });
      expect(events.some(event => event.type === 'tool')).toBe(true);
      expect(transport.data.canvases[scene.id].nodes).toHaveLength(scene.steps.flatMap(step => step.nodes).length);
      expect(transport.data.sessions.find(session => session.id === scene.id)?.messages).toHaveLength(2);
    }
    expect(network).not.toHaveBeenCalled();
  });
  it('stops a replay without adding later nodes or leaving the chat sending', async () => {
    vi.useFakeTimers();
    const transport = createShowcaseTransport(origin, vi.fn<typeof fetch>());
    const response = await transport.handle(`${origin}/api/sessions/design/messages`, {
      method: 'POST', body: JSON.stringify({ text: transport.replays.design.prompt }),
    });
    const text = response.text();
    await transport.handle(`${origin}/api/sessions/design/stop`, { method: 'POST' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await text).toContain('"outcome":"interrupted"');
    expect(transport.data.canvases.design.nodes).toHaveLength(0);
    expect(transport.data.sessions.find(session => session.id === 'design')?.lastTurnOutcome).toBe('interrupted');
  });
  it('pauses a hidden scene and replies honestly to an off-script request', async () => {
    vi.useFakeTimers();
    const transport = createShowcaseTransport(origin, vi.fn<typeof fetch>());
    transport.setReplayActivity(() => false);
    const response = await transport.handle(`${origin}/api/sessions/design/messages`, {
      method: 'POST', body: JSON.stringify({ text: '帮我处理自己的任务' }),
    });
    const text = response.text();
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport.data.sessions.find(session => session.id === 'design')?.messages).toHaveLength(1);
    transport.setReplayActivity(() => true);
    await vi.runAllTimersAsync();
    expect(await text).toContain('"type":"text"');
    expect(transport.data.canvases.design.nodes).toHaveLength(0);
    expect(transport.data.sessions.find(session => session.id === 'design')?.messages.at(-1)?.content).toContain('预先准备的示例');
  });
});

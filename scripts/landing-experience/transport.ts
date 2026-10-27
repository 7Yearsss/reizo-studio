import { makeFixtures } from './fixtures';
import { finalText, offScriptReply, replayScenes, type ReplayNode, type ReplayScene } from './replay';
import type { ChatMessage, ReasoningSegment, ToolCallPart } from '../../src/shared/chat';
import type { ChatStreamEvent, TodoItem } from '../../src/shared/stream';
import type { CanvasEdit } from '../../src/shared/canvasEdits';
import type { CanvasNode, CanvasSnapshot } from '../../src/shared/canvas';
import type { CanvasDocumentChange, CanvasSyncMessage } from '../../src/shared/canvasSync';
import type { DirEntry } from '../../src/shared/workspace';
import type { ReizoBridge } from '../../src/shared/window';

const disabled = '这是工作台界面体验。要与 Agent 对话或生成新作品，请进入 REIZO 工作台。';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Browser-local adapter. No database, keys, IPC, AI calls, or outbound API fallback. */
export function createShowcaseTransport(origin: string, nativeFetch: typeof fetch) {
  const data = makeFixtures();
  const activeTurns = new Map<string, AbortController>();
  let replayActive: (id: string) => boolean = () => true;
  const subscriptions = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  const encode = (message: CanvasSyncMessage) => new TextEncoder().encode(JSON.stringify(message) + '\n');
  function commit(snapshot: CanvasSnapshot, changes: CanvasDocumentChange[], mutationId?: string) {
    if (!changes.length) return;
    snapshot.canvas.liveRevision++;
    const payload: CanvasSyncMessage = { v: 2, kind: 'commit', canvasId: snapshot.canvas.id, epoch: 'showcase',
      commit: { canvasId: snapshot.canvas.id, revision: snapshot.canvas.liveRevision, changes, mutationId } };
    for (const controller of subscriptions.get(snapshot.canvas.id) ?? []) controller.enqueue(encode(payload));
  }
  function apply(snapshot: CanvasSnapshot, edits: CanvasEdit[], mutationId?: string) {
    const changes: CanvasDocumentChange[] = [];
    for (const edit of edits) {
      if (edit.kind === 'add_node') {
        const node: CanvasNode = { id: edit.id, canvasId: snapshot.canvas.id, type: edit.node.type, x: edit.node.x, y: edit.node.y,
          w: edit.node.w ?? 280, h: edit.node.h ?? 260, title: edit.node.title ?? '新节点', params: edit.node.params ?? {},
          runState: 'idle', paramsHash: null, output: null, updatedAt: new Date().toISOString(), ...edit.patch };
        snapshot.nodes.push(node); changes.push({ type: 'node_added', node });
      } else if (edit.kind === 'update_node') {
        const node = snapshot.nodes.find(n => n.id === edit.id);
        if (node) { Object.assign(node, edit.patch); changes.push({ type: 'node_updated', node }); }
      } else if (edit.kind === 'delete_node') {
        snapshot.nodes = snapshot.nodes.filter(n => n.id !== edit.id);
        for (const edge of snapshot.edges.filter(e => e.sourceId === edit.id || e.targetId === edit.id)) changes.push({ type: 'edge_deleted', id: edge.id });
        snapshot.edges = snapshot.edges.filter(e => e.sourceId !== edit.id && e.targetId !== edit.id);
        changes.push({ type: 'node_deleted', id: edit.id });
      } else if (edit.kind === 'add_edge') {
        const edge = { ...edit.edge, canvasId: snapshot.canvas.id }; snapshot.edges.push(edge); changes.push({ type: 'edge_added', edge });
      } else {
        snapshot.edges = snapshot.edges.filter(e => e.id !== edit.id); changes.push({ type: 'edge_deleted', id: edit.id });
      }
    }
    commit(snapshot, changes, mutationId);
  }

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ndjson = { headers: { 'content-type': 'application/x-ndjson' } };
  /** A scripted turn streamed through the real chat protocol: thinking → todos → tool cards → canvas → reply. */
  function playTurn(sessionId: string, text: string, signal?: AbortSignal | null): Response {
    if (activeTurns.has(sessionId)) return json({ error: '示例正在播放' }, 409);
    const cancellation = new AbortController();
    activeTurns.set(sessionId, cancellation);
    const abort = () => cancellation.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) cancellation.abort();
    const session = data.sessions.find(s => s.id === sessionId)!;
    const candidate = replayScenes[sessionId];
    const scene: ReplayScene | undefined = session.messages.length === 0 && text === candidate?.prompt ? candidate : undefined;
    const snapshot = data.canvases[sessionId];
    const encoder = new TextEncoder();
    const startedAt = Date.now();
    const userMessage: ChatMessage = { id: `${sessionId}-u-${startedAt}`, role: 'user', content: text, createdAt: new Date(startedAt).toISOString() };
    session.messages.push(userMessage);
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      const wait = async (ms: number) => {
        let remaining = reduced ? 0 : ms;
        do {
          if (cancellation.signal.aborted) throw new DOMException('aborted', 'AbortError');
          const allowed = replayActive(sessionId);
          if (allowed && remaining <= 0) return;
          const slice = Math.min(50, Math.max(1, remaining));
          await new Promise(resolve => setTimeout(resolve, allowed ? slice : 50));
          if (allowed) remaining -= slice;
        } while (true);
      };
      const typeOut = async (type: 'text' | 'reasoning', value: string, size = 3, ms = 26) => {
        if (reduced) { send({ type, delta: value }); return; }
        for (let i = 0; i < value.length; i += size) { send({ type, delta: value.slice(i, i + size) }); await wait(ms); }
      };
      const parts: ToolCallPart[] = [];
      const segments: ReasoningSegment[] = [];
      const think = async (value: string) => {
        const t = Date.now();
        send({ type: 'status', phase: 'thinking' });
        await typeOut('reasoning', value);
        await wait(260);
        segments.push({ text: value, durationMs: Date.now() - t, beforeToolIndex: parts.length });
      };
      const land = (node: ReplayNode) => {
        const edits: CanvasEdit[] = [{ kind: 'add_node', id: node.id,
          node: { type: node.type, x: node.x, y: node.y, w: node.w, h: node.h, title: node.title, params: node.params },
          patch: { runState: node.asset ? 'running' : 'done' } } as unknown as CanvasEdit];
        for (const from of node.from ?? []) {
          const source = snapshot.nodes.find(n => n.id === from);
          if (!source) continue;
          edits.push({ kind: 'add_edge', edge: { id: `${from}->${node.id}`, sourceId: from, targetId: node.id,
            sourceHandle: source.type === 'image' ? 'image_out' : 'prompt_out',
            targetHandle: node.type === 'note' ? 'text_in' : source.type === 'image' ? 'reference' : 'prompt' } } as unknown as CanvasEdit);
        }
        apply(snapshot, edits);
      };
      try {
        let reply = offScriptReply;
        if (scene) {
          await wait(500);
          await think(scene.thinking);
          const todos = (active: number): TodoItem[] => scene.steps.map((step, i) => ({ id: `${scene.id}-todo-${i}`, content: step.title,
            status: i < active ? 'completed' : i === active ? 'in_progress' : 'pending' }));
          for (const [index, step] of scene.steps.entries()) {
            send({ type: 'todos', items: todos(index) });
            await think(step.thinking);
            send({ type: 'status', phase: 'tools' });
            const many = step.nodes.length > 1;
            const part: ToolCallPart = { type: 'tool', id: `${scene.id}-tool-${index}`, name: many ? 'create_storyboard_pipeline' : 'add_node',
              args: many ? { title: step.title, count: step.nodes.length } : { type: step.nodes[0].type, title: step.nodes[0].title } };
            send(part);
            for (const node of step.nodes) { land(node); await wait(380); }
            const media = step.nodes.filter(n => n.asset);
            if (media.length) {
              await wait(1100);
              for (const node of media) {
                apply(snapshot, [{ kind: 'update_node', id: node.id, patch: { runState: 'done', output: { assets: [node.asset!] } } } as unknown as CanvasEdit]);
                await wait(220);
              }
            } else await wait(500);
            part.result = JSON.stringify(many ? { createdNodeIds: step.nodes.map(n => n.id) } : { id: step.nodes[0].id });
            send(part);
            parts.push(part);
            await wait(320);
          }
          send({ type: 'todos', items: todos(scene.steps.length) });
          reply = finalText(scene);
        } else {
          await wait(400);
          send({ type: 'status', phase: 'thinking' });
          await wait(600);
        }
        send({ type: 'status', phase: 'replying' });
        await typeOut('text', reply, 4, 22);
        const assistant: ChatMessage = { id: `${sessionId}-a-${Date.now()}`, role: 'assistant', content: reply, createdAt: new Date().toISOString(),
          turnOutcome: 'completed', durationMs: Date.now() - startedAt,
          ...(parts.length ? { parts } : {}),
          ...(segments.length ? { reasoning: segments.map(s => s.text).join('\n\n'), reasoningSegments: segments } : {}) };
        session.messages.push(assistant);
        session.lastTurnOutcome = 'completed';
        session.updatedAt = assistant.createdAt;
        send({ type: 'done', outcome: 'completed' });
        controller.close();
      } catch {
        session.lastTurnOutcome = 'interrupted';
        for (const node of snapshot.nodes.filter(node => node.runState === 'running')) {
          apply(snapshot, [{ kind: 'update_node', id: node.id, patch: { runState: 'idle' } }]);
        }
        try { send({ type: 'done', outcome: 'interrupted' }); controller.close(); } catch { /* reader already cancelled */ }
      } finally {
        signal?.removeEventListener('abort', abort);
        activeTurns.delete(sessionId);
      }
    }, cancel() { cancellation.abort(); } });
    return new Response(body, ndjson);
  }

  const handle: typeof fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);
    if (!url.href.startsWith(origin + '/api/')) {
      if (url.origin !== new URL(origin).origin || /\/api\//.test(url.pathname)) return json({ error: disabled }, 403);
      return nativeFetch(input, init);
    }
    const path = url.pathname.slice(new URL(origin).pathname.length);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/settings') {
      if (method !== 'GET') {
        if (body.provider?.apiKey || body.computerUse) return json({ error: disabled }, 403);
        Object.assign(data.settings, { ...body, appearance: 'light', computerUse: false });
      }
      return json(data.settings);
    }
    if (/^\/api\/settings\/providers\/.+\/models$/.test(path)) return json({ models: data.settings.providers[0].models });
    if (path === '/api/sessions') {
      if (method !== 'GET') return json({ error: disabled }, 403);
      return json({ sessions: data.sessions.map(({ messages, ...summary }) => ({ ...summary, listMessageCount: messages.length })) });
    }
    const sessionPath = path.match(/^\/api\/sessions\/([^/]+)(?:\/(.+))?$/);
    if (sessionPath) {
      const session = data.sessions.find(s => s.id === sessionPath[1]);
      if (!session) return json({ error: '示例任务不存在' }, 404);
      const suffix = sessionPath[2];
      if (suffix === 'interactions') return json({ interactions: [] });
      if (suffix === 'artifacts') return json({ artifacts: [] });
      if (suffix === 'stream/resume') return new Response(JSON.stringify({ type: 'done', outcome: 'completed' }) + '\n', ndjson);
      if (suffix === 'messages' && method === 'POST' && replayScenes[session.id]) return playTurn(session.id, String(body.text ?? ''), init?.signal);
      if (suffix === 'stop' && method === 'POST') { activeTurns.get(session.id)?.abort(); return json({ ok: true }); }
      if (suffix || method !== 'GET') return json({ error: disabled }, 403);
      return json({ session });
    }
    if (path === '/api/projects') return json({ projects: [] });
    if (path === '/api/skills') return json({ skills: [] });
    if (path === '/api/artifacts') return json({ artifacts: [] });
    if (path === '/api/memory/events') return json({ events: [] });
    if (path === '/api/schedules') return json({ schedules: [], presets: [] });
    if (path === '/api/schedules/thoughts') return json({ thoughts: [] });
    if (path === '/api/providers/catalog') return json({ providers: [], defaultIds: {}, defaults: {} });
    if (path === '/api/canvas/assets/library') return json({ assets: [], items: [], nextCursor: null });
    const canvasPath = path.match(/^\/api\/canvas\/([^/]+)(?:\/(.+))?$/);
    if (canvasPath) {
      const id = canvasPath[1], suffix = canvasPath[2];
      const snapshot = data.canvases[id];
      if (!snapshot) return json({ error: '示例画布不存在' }, 404);
      if (!suffix && method === 'GET') return json(snapshot);
      if (suffix === 'stream') {
        let active: ReadableStreamDefaultController<Uint8Array> | undefined;
        const set = subscriptions.get(id) ?? new Set(); subscriptions.set(id, set);
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          active = controller; set.add(controller);
          controller.enqueue(encode({ v: 2, kind: 'heartbeat', canvasId: id, epoch: 'showcase', revision: snapshot.canvas.liveRevision }));
        }, cancel() { if (active) set.delete(active); } });
        return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
      }
      if (suffix === 'selection') return json({ ok: true });
      if (suffix === 'jobs') return json({ jobs: [], nextCursor: null });
      if (suffix === 'deliveries') return json({ deliveries: [] });
      if (suffix === 'edits' && method === 'POST') {
        if (body.uploads?.length) return json({ error: disabled }, 403);
        apply(snapshot, body.edits ?? [], new Headers(init?.headers).get('Idempotency-Key') ?? undefined);
        return json({ snapshot });
      }
      const nodePath = suffix?.match(/^nodes\/([^/]+)$/);
      if (nodePath && method === 'PATCH') {
        apply(snapshot, [{ kind: 'update_node', id: nodePath[1], patch: body }]);
        return json({ node: snapshot.nodes.find(n => n.id === nodePath[1]) });
      }
      if (nodePath && method === 'DELETE') { apply(snapshot, [{ kind: 'delete_node', id: nodePath[1] }]); return json({ ok: true }); }
      if (suffix === 'nodes' && method === 'POST') {
        const nodeId = body.id ?? crypto.randomUUID();
        apply(snapshot, [{ kind: 'add_node', id: nodeId, node: { x: 0, y: 0, ...body } }]);
        return json({ node: snapshot.nodes.find(n => n.id === nodeId) });
      }
      const edgePath = suffix?.match(/^edges\/([^/]+)$/);
      if (edgePath && method === 'DELETE') { apply(snapshot, [{ kind: 'delete_edge', id: edgePath[1] }]); return json({ ok: true }); }
      if (suffix === 'edges' && method === 'POST') {
        const edge = { id: crypto.randomUUID(), sourceHandle: null, targetHandle: null, ...body };
        apply(snapshot, [{ kind: 'add_edge', edge }]); return json({ edge: { ...edge, canvasId: id } });
      }
    }
    return json({ error: disabled }, 403);
  };
  return { handle, data, replays: replayScenes, setReplayActivity: (active: (id: string) => boolean) => { replayActive = active; } };
}

export function installShowcaseTransport() {
  const origin = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const transport = createShowcaseTransport(origin, window.fetch.bind(window));
  window.fetch = transport.handle;
  // Every store writes into an iframe-local in-memory namespace, never site account storage.
  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)); },
      removeItem: key => { values.delete(key); }, clear: () => values.clear() };
  }
  Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
  const unsupported = async (): Promise<never> => { throw new Error(disabled); };
  const bridge = { getApiOrigin: async () => origin, openExternal: async (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); }, platform: 'web', listWorkspace: async (): Promise<DirEntry[]> => [], flattenWorkspace: async (): Promise<DirEntry[]> => [],
    accountStatus: async () => ({ status: 'signed-out' as const, webOrigin: origin, message: '此为演示页面，请在桌面工作台中登录。' }),
    accountLogin: unsupported, accountPasswordLogin: unsupported, accountLogout: unsupported, accountReopen: unsupported, accountRefresh: unsupported,
    accountWallet: unsupported, accountTopup: unsupported, accountTopupOpen: unsupported,
    readWorkspaceFile: unsupported, pickFolder: async () => null, windowIsMaximized: async () => false,
    windowMinimize: async (): Promise<void> => {}, windowClose: async (): Promise<void> => {}, windowToggleMaximize: async () => false,
    runCommand: unsupported, readDroppedFile: unsupported, revealInFolder: unsupported,
    deleteWorkspacePath: unsupported, createWorkspaceEntry: unsupported, gitStatus: async () => ({ available: false, branch: null, dirty: false, porcelain: '', recent: '' }),
    installSkill: unsupported, uninstallSkill: unsupported, listPlugins: async () => [], searchMcpCatalog: async () => ({ items: [] }), listPluginCatalog: async () => ({ marketplace: '', items: [] }), installCatalogPlugin: unsupported, listMcpServers: async () => [], saveMcpServers: unsupported, testMcpServer: unsupported, listHooks: async () => [], saveHooks: unsupported, relaunchApp: unsupported, quickSubmit: async () => false, quickHide: async () => undefined, onQuickAsk: () => () => undefined, onDeepLink: () => () => undefined, onQuickReset: () => () => undefined, installPlugin: unsupported, setPluginConfig: unsupported, previewPlugin: unsupported, installPreviewedPlugin: unsupported, setPluginEnabled: unsupported, uninstallPlugin: unsupported, searchSkillHub: async () => ({ items: [], total: 0 }),
    installSkillHubSkill: unsupported, previewSkillHubSkill: unsupported, exportPdf: unsupported,
    checkNodeEnvironment: async () => ({ available: true, version: 'v20.0.0' }),
    resetMcpBaseline: unsupported,
    getQuickIntegrationsStatus: async () => ({
      notion: { connected: false },
      gmail: { connected: false },
      feishu: { connected: false },
      wecom: { connected: false },
      dingtalk: { connected: false },
      yuque: { connected: false },
      gitee: { connected: false },
      github: { connected: false },
    }),
    connectNotion: unsupported,
    startGoogleOAuth: unsupported,
    connectFeishu: unsupported,
    connectWeCom: unsupported,
    connectDingTalk: unsupported,
    connectYuque: unsupported,
    connectGitee: unsupported,
    connectGitHub: unsupported,
    disconnectIntegration: unsupported,
  } satisfies Omit<ReizoBridge, 'platform'> & { platform: 'web' };

  window.reizo = bridge as unknown as ReizoBridge;
  return transport;
}

import { randomBytes, createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VIDEO_EDITOR_TOOLS, type VideoEditorWorkspace } from '../../../shared/videoEditor';
import { EditorMcpClient, editorResult } from './mcpClient';
import { loadEditorRuntime } from './runtime';
import { reviewedVideoDraft, videoApprovalFor, type ReviewedVideoDraft } from './approval';

export interface VideoEditorEngine { origin: string; token: string; kill(): void }
interface Binding { projectId: string; name: string }
const services = new Map<string, VideoEditorService>();

/** Milliseconds of inactivity before the engine process is stopped (default 15 min); REIZO_VIDEO_EDITOR_IDLE_MS=0 disables it. */
function defaultIdleMs(): number {
  const raw = process.env.REIZO_VIDEO_EDITOR_IDLE_MS;
  const configured = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : 15 * 60_000;
}

export function videoEditorFor(dataRoot: string): VideoEditorService {
  let service = services.get(dataRoot);
  if (!service) { service = new VideoEditorService(dataRoot); services.set(dataRoot, service); }
  return service;
}
export function stopVideoEditor(dataRoot: string): void {
  services.get(dataRoot)?.stop();
  services.delete(dataRoot);
}

export class VideoEditorService {
  private engine?: Promise<VideoEditorEngine>;
  private child?: { kill(): unknown };
  private stopped = false;
  private clients = new Map<string, EditorMcpClient>();
  private opens = new Map<string, Promise<VideoEditorWorkspace>>();
  private bindings = new Map<string, Binding>();
  private previewed = new Set<string>();
  private inflight = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private busyProbes = new Set<() => boolean>();
  constructor(private dataRoot: string, private launchEngine?: () => Promise<VideoEditorEngine>, private idleMs = defaultIdleMs()) {}

  /** Work the service cannot see (e.g. host-owned export tasks) that must keep the engine alive. */
  addBusyProbe(probe: () => boolean): () => void {
    this.busyProbes.add(probe);
    return () => { this.busyProbes.delete(probe); };
  }
  /** (Re)starts the idle countdown; every engine use pushes shutdown back. */
  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (!this.idleMs || this.stopped || !this.engine) return;
    this.idleTimer = setTimeout(() => { void this.shutdownIfIdle(); }, this.idleMs);
    this.idleTimer.unref?.();
  }
  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.inflight++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    try { return await work(); } finally { this.inflight--; this.armIdle(); }
  }
  private busy(): boolean { return this.inflight > 0 || [...this.busyProbes].some((probe) => { try { return probe(); } catch { return true; } }); }
  /**
   * Stops the engine process when nothing needs it: no calls in flight, no active export, and no
   * editor panel connected (a connected panel holds the open draft in its browser). If the engine
   * cannot say whether a panel is connected, it stays alive. The next use relaunches it.
   */
  async shutdownIfIdle(): Promise<boolean> {
    if (this.stopped || !this.engine) return false;
    if (this.busy()) { this.armIdle(); return false; }
    const pending = this.engine;
    const engine = await pending.catch((): undefined => undefined);
    if (!engine) return false;
    let probe: EditorMcpClient | undefined;
    try {
      const client = this.clients.values().next().value ?? (probe = new EditorMcpClient(engine.origin, engine.token));
      const status = editorResult(await client.call('openchatcut_status'));
      if (!Array.isArray(status.connectedProjectIds) || status.connectedProjectIds.length > 0) { this.armIdle(); return false; }
    } catch { this.armIdle(); return false; }
    finally { void probe?.close(); }
    // The status read awaited: re-check that nothing started or replaced the engine meanwhile.
    if (this.stopped || this.engine !== pending || this.busy()) { this.armIdle(); return false; }
    this.engine = undefined; this.child = undefined;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    for (const client of this.clients.values()) void client.close();
    // Cached workspaces carry the old loopback origin; the relaunched engine has a new one.
    this.clients.clear(); this.opens.clear(); this.previewed.clear();
    engine.kill();
    return true;
  }

  private start(): Promise<VideoEditorEngine> {
    if (this.stopped) return Promise.reject(new Error('剪辑引擎已关闭'));
    if (!this.engine) this.engine = (this.launchEngine ? this.launchEngine() : this.launch()).catch((e) => { this.engine = undefined; throw e; });
    this.armIdle();
    return this.engine;
  }
  private async launch(): Promise<VideoEditorEngine> {
    const config = await loadEditorRuntime();
    if (config.integrationVersion !== 2) throw new Error('剪辑素材通道需要更新。请运行 npm run setup:video-editor -- --skip-install。');
    if (!config.renderBundleId || !/^[a-f0-9]{64}$/.test(config.renderBundleId)) throw new Error('渲染资源需要更新，请运行 npm run setup:video-editor -- --skip-install。');
    for (const [label, file] of [['Node', config.node], ['渲染浏览器', config.browserExecutable], ['渲染资源', path.join(config.renderBundle, 'index.html')], ['剪辑服务', config.entry]]) {
      if (!file || !path.isAbsolute(file) || !existsSync(file)) throw new Error(`${label}依赖缺失，请运行 npm run check:video-editor 检查。`);
    }
    const token = randomBytes(32).toString('base64url');
    const root = path.join(this.dataRoot, 'video-editor');
    await mkdir(root, { recursive: true });
    let renderBundle: string | undefined;
    if (config.renderBundle && path.isAbsolute(config.renderBundle) && existsSync(path.join(config.renderBundle, 'index.html'))) {
      // Upstream rewrites media/uploads inside its render bundle. Give each
      // data root a private copy; never point it at the standalone installation.
      const marker = JSON.parse(await readFile(path.join(config.renderBundle, '.reizo-render.json'), 'utf8')) as { id?: string };
      if (marker.id !== config.renderBundleId) throw new Error('渲染资源版本不匹配，请重新运行 setup:video-editor。');
      renderBundle = path.join(root, `render-bundle-${config.renderBundleId.slice(0, 16)}`);
      const ready = path.join(renderBundle, '.reizo-ready');
      if (!existsSync(ready)) {
        const uploads = path.join(config.renderBundle, 'media', 'uploads');
        await cp(config.renderBundle, renderBundle, { recursive: true, filter: (source) => source !== uploads && !source.startsWith(uploads + path.sep) });
        await writeFile(ready, config.renderBundleId);
      }
    }
    if (this.stopped) throw new Error('剪辑引擎已关闭');
    const env = {
      ...process.env,
      OPENCHATCUT_DEV_PROFILE_ID: '78acb451-2d0b-4f43-8b2d-fd83ba3d5b19',
      OPENCHATCUT_DATA_DIR: root,
      OPENCHATCUT_MCP_TOKEN: token,
      REIZO_EDITOR_PARENT_PID: String(process.pid),
      AGENT_IMPORT_ROOTS: path.join(this.dataRoot, 'canvas'),
      // The Windows preview uses software GL: this host's D3D headless
      // startup times out. An explicit renderer preference remains respected.
      ...(process.platform === 'win32' && !process.env.CC_RENDER_GL ? { CC_RENDER_GL: 'swangle' } : {}),
      ...(config.browserExecutable && path.isAbsolute(config.browserExecutable) && existsSync(config.browserExecutable) ? { CC_BROWSER_EXECUTABLE: config.browserExecutable } : {}),
      ...(renderBundle ? { CC_REMOTION_BUNDLE: renderBundle } : {}),
    };
    const child = spawn(config.node, [config.entry], { cwd: config.packaged ? root : config.source, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    return await new Promise<VideoEditorEngine>((resolve, reject) => {
      let settled = false;
      let log = '';
      const timeout = setTimeout(() => fail(new Error('剪辑引擎启动超时，请检查本地依赖后重试。')), 180_000);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); child.kill(); reject(error);
      };
      child.on('error', () => fail(new Error('无法启动剪辑引擎，请重新运行 npm run setup:video-editor。')));
      child.on('exit', () => {
        if (this.child !== child) return;
        this.engine = undefined; this.clients.clear(); this.opens.clear();
        fail(new Error('剪辑引擎意外退出，请重新打开面板。'));
      });
      // Never forward the upstream startup log: it may contain provider configuration.
      child.stderr.on('data', () => undefined);
      child.stdout.on('data', (chunk) => {
        log = (log + chunk.toString()).slice(-32_000);
        const match = log.match(/REIZO_EDITOR_READY (\{[^\n]+\})/);
        if (!match || settled) return;
        try {
          const value = JSON.parse(match[1]) as { origin: string };
          const url = new URL(value.origin);
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return fail(new Error('剪辑引擎地址无效'));
          settled = true; clearTimeout(timeout);
          resolve({ origin: url.origin, token, kill: () => child.kill() });
        } catch { fail(new Error('剪辑引擎启动响应无效')); }
      });
    });
  }

  /** Internal HTTP access to the render engine; does not depend on an attached editor. */
  async renderRequest(method: 'GET' | 'POST' | 'DELETE', id?: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    if (id !== undefined && !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('导出任务编号无效');
    return this.track(async () => {
    const engine = await this.start();
    return fetch(`${engine.origin}/export/job${id ? `/${id}` : ''}`, {
      method, headers: { Origin: engine.origin, 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180_000)]),
    });
    });
  }
  async renderOutput(file: string, signal: AbortSignal): Promise<Buffer> {
    if (!/^\/media\/uploads\/[a-zA-Z0-9_.-]+\.(mp4|webm|mp3|wav)$/i.test(file)) throw new Error('成片路径无效');
    return this.track(() => this.readRenderOutput(file, signal));
  }
  private async readRenderOutput(file: string, signal: AbortSignal): Promise<Buffer> {
    const engine = await this.start();
    const response = await fetch(engine.origin + file, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error' });
    if (response.status === 404) throw Object.assign(new Error('渲染成片已不存在，请重新导出'), { code: 'OUTPUT_MISSING' });
    if (!response.ok || !response.body) throw new Error('无法读取渲染成片');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 256 * 1024 * 1024) { await reader.cancel(); throw new Error('成片超过 256 MB'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  private bindingFile(sessionId: string): string {
    return path.join(this.dataRoot, 'video-editor-bindings', `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  }
  private async client(sessionId: string): Promise<EditorMcpClient> {
    const engine = await this.start();
    let client = this.clients.get(sessionId);
    if (!client) { client = new EditorMcpClient(engine.origin, engine.token); this.clients.set(sessionId, client); }
    return client;
  }
  async reconnect(sessionId: string, title: string): Promise<VideoEditorWorkspace> {
    await this.clients.get(sessionId)?.close();
    this.clients.delete(sessionId);
    this.opens.delete(sessionId);
    return this.open(sessionId, title);
  }
  open(sessionId: string, title: string): Promise<VideoEditorWorkspace> {
    const existing = this.opens.get(sessionId);
    if (existing) return existing;
    const pending = this.track(() => this.openProject(sessionId, title)).catch((e) => { this.opens.delete(sessionId); throw e; });
    this.opens.set(sessionId, pending);
    return pending;
  }
  private async openProject(sessionId: string, title: string): Promise<VideoEditorWorkspace> {
    const client = await this.client(sessionId);
    const file = this.bindingFile(sessionId);
    let binding: Binding | undefined;
    try { binding = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('剪辑工程关联无法读取，已停止创建以保护原工程。'); }
    if (!binding) {
      const created = editorResult(await client.call('create_project', { name: `${title || '新对话'} · 剪辑`, compositionWidth: 1920, compositionHeight: 1080, fps: 30 }));
      const project = (created.project ?? created) as { id?: string; name?: string };
      if (!project.id) throw new Error('剪辑工程创建结果无效');
      binding = { projectId: project.id, name: project.name || title };
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(binding));
      await rename(`${file}.tmp`, file);
    }
    if (!binding.projectId || typeof binding.projectId !== 'string') throw new Error('剪辑工程关联无效');
    this.bindings.set(sessionId, binding);
    const engine = await this.start();
    return { ...binding, url: `${engine.origin}/?project=${encodeURIComponent(binding.projectId)}` };
  }

  private async ready(sessionId: string, preserveDraftBinding = false): Promise<{ client: EditorMcpClient; binding: Binding }> {
    const binding = this.bindings.get(sessionId);
    if (!binding) throw new Error('请先打开当前对话右侧的「视频剪辑」面板。');
    const client = await this.client(sessionId);
    const status = editorResult(await client.call('openchatcut_status'));
    const ids = status.connectedProjectIds;
    if (!Array.isArray(ids) || !ids.includes(binding.projectId)) throw new Error('当前剪辑工作台尚未连接。请保持「视频剪辑」面板打开，等待工程加载完成。');
    // Explicitly rebind the SAME project after the iframe is reopened. Upstream
    // rejects stale drafts instead of replaying them over a changed document.
    // Terminal reads must retain the draft's original revision. Upstream permits
    // drift for the owning transport; retargeting after Apply loses that proof.
    if (!preserveDraftBinding) editorResult(await client.call('target_project', { projectId: binding.projectId }));
    return { client, binding };
  }
  async catalog(sessionId: string) {
    return this.track(async () => {
      const { client } = await this.ready(sessionId);
      return (await client.list()).filter((t) => VIDEO_EDITOR_TOOLS.has(t.name));
    });
  }
  async pendingReview(sessionId: string, signal?: AbortSignal): Promise<ReviewedVideoDraft | null> {
    const result = editorResult(await this.call(sessionId, 'list_edit_sessions', {}, signal));
    const entries = Array.isArray(result) ? result : result.result;
    if (!Array.isArray(entries)) return null;
    const pending = entries.map(reviewedVideoDraft).filter((draft): draft is ReviewedVideoDraft => draft !== null);
    return pending.length === 1 ? pending[0] : null;
  }
  async applyReviewed(sessionId: string, expected: ReviewedVideoDraft, signal?: AbortSignal, requireAutoMode = false) {
    // Reconnect/reuse may adopt an orphan, but can never substitute another proposal.
    const current = await this.pendingReview(sessionId, signal);
    if (!current || current.editSessionId !== expected.editSessionId || current.proposalId !== expected.proposalId) throw new Error('待确认草稿已经变化，请查看后重新发送“应用这一版”。');
    const adopted = editorResult(await this.call(sessionId, 'begin_edit_session', { reuseExisting: true }, signal));
    if (adopted.editSessionId !== expected.editSessionId || adopted.proposalId !== expected.proposalId || adopted.status !== 'awaiting_review') throw new Error('待确认草稿已经变化，未应用。');
    const { client, binding } = await this.ready(sessionId);
    if (requireAutoMode && await videoApprovalFor(this.dataRoot).read(sessionId) !== 'auto') {
      return client.call('get_edit_session', { editSessionId: expected.editSessionId, editorProjectId: binding.projectId }, signal);
    }
    // This lifecycle tool is deliberately absent from the model-call allowlist.
    return client.call('apply_reviewed_edit_session', { ...expected, editorProjectId: binding.projectId }, signal);
  }
  call(sessionId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.track(() => this.callTool(sessionId, name, args, signal));
  }
  private async callTool(sessionId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (!VIDEO_EDITOR_TOOLS.has(name)) throw new Error('当前剪辑模块未开放这个工具。');
    const { client, binding } = await this.ready(sessionId, name === 'get_edit_session');
    if (args.editorProjectId && args.editorProjectId !== binding.projectId) throw new Error('不能操作其他对话的剪辑工程。');
    const previewKey = `${sessionId}:${String(args.editSessionId)}`;
    const autoReview = name === 'review_edit_session' && await videoApprovalFor(this.dataRoot).read(sessionId) === 'auto';
    if (autoReview && !this.previewed.has(previewKey)) throw new Error('自动应用前，请先用 view_timeline_frames 检查最后一次修改后的实际预览，再提交 review_edit_session。');
    const preservesPreview = /^(?:read_|get_|list_|view_|search_|load_skill$|review_edit_session$|track_export$|verify_export$)/.test(name);
    if (!preservesPreview) this.previewed.delete(previewKey);
    if (name === 'begin_edit_session') {
      // An idle browser long-poll may still carry the revision from before a
      // manual import. Synchronize it with a read before starting a draft.
      // Only this read may be retried on an explicit stale result; never edits.
      const probeArgs = { editorProjectId: binding.projectId };
      let probe = await client.call('list_edit_sessions', probeArgs, signal);
      let stale = false;
      try { stale = probe.isError === true && editorResult({ ...probe, isError: false }).outcome === 'stale'; } catch { /* preserve the original error below */ }
      if (stale) {
        editorResult(await client.call('target_project', { projectId: binding.projectId }, signal));
        probe = await client.call('list_edit_sessions', probeArgs, signal);
      }
      editorResult(probe);
      // The read flushes browser autosaves and can advance the registry revision
      // (e.g. immediately after Undo). Bind to that settled revision before Begin.
      editorResult(await client.call('target_project', { projectId: binding.projectId }, signal));
    }
    const safeArgs = { ...args, editorProjectId: binding.projectId };
    // Always use upstream manual mode: its auto mode also bypasses real-tool confirmations.
    if (name === 'begin_edit_session') Object.assign(safeArgs, { approvalMode: 'manual', clientName: 'Reizo Agent' });
    const result = await client.call(name, safeArgs, signal);
    if (name === 'view_timeline_frames' && !result.isError && result.content.some((part) => part.type === 'image')) this.previewed.add(previewKey);
    if (autoReview && !result.isError && await videoApprovalFor(this.dataRoot).read(sessionId) === 'auto') {
      const draft = reviewedVideoDraft(editorResult(result));
      if (draft) {
        this.previewed.delete(previewKey);
        return this.applyReviewed(sessionId, draft, signal, true);
      }
    }
    if (name === 'begin_edit_session' && result.isError) {
      // Begin can lose the race to Undo/autosave after the synchronization read.
      // Only this exact browser precondition failure proves Begin never ran.
      // Reconcile with a fresh session list before making ONE new attempt;
      // transport failures and all edit mutations remain non-retryable here.
      let failed: Record<string, unknown> = {};
      try { failed = editorResult({ ...result, isError: false }); } catch { /* retain original error */ }
      if (failed.outcome === 'stale' && failed.message === `Project ${binding.projectId} changed; re-initialize the MCP session.`) {
        editorResult(await client.call('target_project', { projectId: binding.projectId }, signal));
        const listed = editorResult(await client.call('list_edit_sessions', { editorProjectId: binding.projectId }, signal));
        const sessions = Array.isArray(listed.result) ? listed.result : listed;
        if (Array.isArray(sessions) && !sessions.some((session) => ['drafting', 'awaiting_review'].includes(session.status))) {
          editorResult(await client.call('target_project', { projectId: binding.projectId }, signal));
          return client.call(name, safeArgs, signal);
        }
      }
    }
    return result;
  }
  stop(): void {
    this.stopped = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    for (const client of this.clients.values()) void client.close();
    this.clients.clear(); this.opens.clear();
    this.child?.kill();
  }
}

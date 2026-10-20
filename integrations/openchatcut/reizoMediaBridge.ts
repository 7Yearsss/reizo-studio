// Reizo host bridge. No filesystem paths, provider credentials or backend tokens enter this frame.
import { useEffect, useRef } from 'react';
import type { EditorWorkspaceViewProps } from './EditorWorkspaceView';
import type { ExportJobResult } from '../export/exportWorkflowTypes';
import type { ExternalProposalController } from '../agent/useExternalAgentBridge';
import type { MediaAsset } from './types';

type ActivityState = 'working' | 'awaiting_review' | 'awaiting_confirmation' | 'applied' | 'rejected' | 'exporting' | 'saving' | 'failed' | 'cancelled';
const activities: Array<{ id: string; at: number; state: ActivityState; message: string }> = [];
let selectedMedia: MediaAsset[] = [];
export function reportReizoActivity(state: ActivityState, message: string) {
  activities.push({ id: crypto.randomUUID(), at: Date.now(), state, message: message.slice(0, 1000) });
  if (activities.length > 30) activities.shift();
}
export function useReizoPoolSelection(assets: MediaAsset[]) {
  useEffect(() => { selectedMedia = assets; return () => { selectedMedia = []; }; }, [assets]);
}

export async function saveReizoSelectedMedia(assets: MediaAsset[]) {
  // Capture selected objects before awaiting so later selection changes cannot retarget the save.
  for (const asset of assets) {
    if (!asset.src.startsWith('/media/uploads/') && !asset.src.startsWith(`blob:${location.origin}/`)) throw new Error('仅支持当前工程已导入的本地素材');
    const response = await fetch(asset.src);
    if (!response.ok) throw new Error(`读取素材失败：${asset.name}`);
    if (Number(response.headers.get('content-length')) > 256 * 1024 * 1024) throw new Error('素材超过 256 MB');
    const blob = await response.blob();
    const ext = /\.(mp4|webm|mov|m4a|mp3|wav|ogg|flac|png|jpe?g|webp|gif)$/i.exec(new URL(asset.src, location.href).pathname)?.[0]
      ?? ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' } as Record<string, string>)[blob.type];
    if (!ext) throw new Error(`暂不支持保存此素材格式：${asset.name}`);
    const name = asset.name.toLowerCase().endsWith(ext.toLowerCase()) ? asset.name : asset.name + ext;
    await saveReizoExport(blob, name, 'source');
  }
}

let connection: { origin: string; nonce: string; projectId: string } | null = null;
const exports = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const renders = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
export function isReizoEmbedded() { return window.parent !== window; }
export async function reizoRenderRequest(method: 'GET' | 'POST' | 'DELETE', renderId?: string, body?: Record<string, unknown>): Promise<Response> {
  if (!connection) throw new Error('工作台导出通道未连接');
  const id = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { renders.delete(id); reject(new Error('导出回执超时，请在工作台查看任务状态')); }, 180_000);
    renders.set(id, { resolve, reject, timer });
    post({ type: 'render-request', id, method, renderId, body });
  });
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}
function post(value: Record<string, unknown>) {
  if (connection) window.parent.postMessage({ channel: 'reizo-media-v1', ...connection, ...value }, connection.origin === 'null' ? '*' : connection.origin);
}

/** Return true only after the host has durably registered the output. */
export async function saveReizoExport(blob: Blob, name: string, purpose: 'export' | 'source' = 'export'): Promise<boolean> {
  if (purpose === 'export' && !/\.(mp4|webm|mp3|wav)$/i.test(name) || window.parent === window) return false;
  if (!connection) throw new Error('工作台素材通道尚未连接，请稍后重试');
  if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('工作台成片保存支持 1 字节至 256 MB');
  const id = crypto.randomUUID();
  reportReizoActivity('saving', `正在保存${purpose === 'source' ? '素材' : '成片'}：${name}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { exports.delete(id); reject(new Error('工作台保存回执超时；请检查素材库后重试')); }, 120_000);
    exports.set(id, { resolve, reject, timer });
    post({ type: 'save-export', id, name, blob, purpose });
  });
  return true;
}

export async function saveReizoRenderedExport(result: ExportJobResult, label: string): Promise<void> {
  if (window.parent === window) return;
  if (!result.path?.startsWith('/media/uploads/')) throw new Error('剪辑成片路径无效');
  const response = await fetch(result.path);
  if (!response.ok) throw new Error('读取剪辑成片失败');
  const ext = result.codec === 'mp3' ? '.mp3' : result.codec === 'wav' ? '.wav' : result.codec === 'vp8' ? '.webm' : '.mp4';
  await saveReizoExport(await response.blob(), /\.(mp4|webm|mp3|wav)$/i.test(label) ? label : label + ext);
}

export function useReizoMediaBridge(props: EditorWorkspaceViewProps, external: ExternalProposalController) {
  const current = useRef(props); current.current = props;
  const review = useRef(external); review.current = external;
  useEffect(() => {
    let alive = true;
    let chain = Promise.resolve();
    const imports = new Map<string, Promise<unknown>>();
    const projectId = props.chatPanel.projectId;
    let previousAwaiting: string | null = null;
    let wasExporting = false;
    let lastError: string | null = null;
    let exportJobs = props.exportDialog?.exportJobs;
    const reportedJobs = new Set<string>();
    const snapshot = () => {
      if (!connection) return;
      const view = current.current;
      exportJobs = view.exportDialog?.exportJobs ?? exportJobs;
      for (const job of exportJobs?.getSnapshot().jobs ?? []) {
        if ((job.progress.phase === 'failed' || job.progress.phase === 'cancelled') && !reportedJobs.has(job.id)) {
          reportedJobs.add(job.id); reportReizoActivity(job.progress.phase, `导出${job.progress.phase === 'failed' ? '失败' : '已取消'}：${job.error ?? job.label}`);
        }
      }
      if (review.current.error && review.current.error !== lastError) reportReizoActivity('failed', review.current.error);
      lastError = review.current.error;
      const doc = view.chatPanel.ctx.getDoc(); const state = view.chatPanel.ctx.getState();
      const timeline = doc.timelines.find((item) => item.id === doc.activeTimelineId);
      if (!timeline) return;
      const awaiting = review.current.pendingGuard ? 'confirmation' : review.current.proposal ? 'review' : null;
      if (awaiting && awaiting !== previousAwaiting) reportReizoActivity(awaiting === 'review' ? 'awaiting_review' : 'awaiting_confirmation', awaiting === 'review' ? 'Agent 修改正在等待你预览并应用' : '操作正在等待你确认');
      previousAwaiting = awaiting;
      if (view.topBar.exporting && !wasExporting) reportReizoActivity('exporting', '正在导出，完成后等待文件保存回执');
      wasExporting = Boolean(view.topBar.exporting);
      const selectedIds = state.selectedIds?.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [];
      post({ type: 'context', activities: [...activities], context: {
        projectId, timeline: { id: timeline.id, name: timeline.name, fps: state.fps, width: state.width, height: state.height, itemCount: state.items.length },
        playheadFrame: view.previewPanel.playerRef.current?.getCurrentFrame() ?? null,
        selectedMedia: selectedMedia.filter((asset) => doc.assets.some((known) => known.id === asset.id)).slice(0, 200).map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind, offline: view.libraryPanel.offlineAssetIds.has(asset.id) })),
        selectedClips: state.items.filter((item) => selectedIds.includes(item.id)).slice(0, 200).map((item) => ({ id: item.id, name: item.name ?? item.kind, kind: item.kind, track: item.track, startFrame: item.startFrame, durationInFrames: item.durationInFrames, ...(item.sourceAssetId ? { assetId: item.sourceAssetId } : {}) })),
        awaiting, exporting: Boolean(view.topBar.exporting),
      } });
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || data?.channel !== 'reizo-media-v1' || data.projectId !== projectId || typeof data.nonce !== 'string') return;
      if (data.type === 'connect') {
        connection = { origin: event.origin, nonce: data.nonce, projectId };
        post({ type: 'ready' }); snapshot(); return;
      }
      if (!connection || event.origin !== connection.origin || data.nonce !== connection.nonce) return;
      if (data.type === 'render-result') {
        const pending = renders.get(data.id);
        if (pending) { clearTimeout(pending.timer); renders.delete(data.id); if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result); }
        return;
      }
      if (data.type === 'export-result') {
        const pending = exports.get(data.id);
        if (pending) { clearTimeout(pending.timer); exports.delete(data.id); if (data.error) pending.reject(new Error(data.error)); else pending.resolve(); }
      }
      if (data.type !== 'import' || !(data.blob instanceof Blob) || data.job?.projectId !== projectId) return;
      const job = data.job;
      if (!imports.has(job.id)) {
        const run = chain.then(async () => {
          if (!alive) throw new Error('剪辑工程已切换');
          const library = current.current.libraryPanel;
          // The filename encodes an immutable Reizo asset ID; a later generation has a new ID.
          const existing = library.assets.find((asset) => asset.sourceContentHash === job.contentHash && !library.offlineAssetIds.has(asset.id));
          const name = library.assets.some((asset) => asset.name === job.name) ? `${crypto.randomUUID()}-${job.name}` : job.name;
          const asset = existing ?? await library.onImportMedia(new File([data.blob], name, { type: job.mimeType }));
          if (!existing) library.onRenameMediaAsset(asset.id, job.label);
          return { sourceAssetId: job.assetId, editorAssetId: asset.id, name: existing ? asset.name : job.label, durationInFrames: asset.durationInFrames };
        });
        imports.set(job.id, run); chain = run.then(() => undefined, () => undefined);
      }
      void imports.get(job.id)!.then((asset) => { if (alive) post({ type: 'import-result', id: job.id, asset }); },
        (error) => { if (alive) post({ type: 'import-result', id: job.id, error: error instanceof Error ? error.message : String(error) }); });
    };
    window.addEventListener('message', receive);
    const timer = setInterval(snapshot, 750);
    return () => {
      clearInterval(timer); selectedMedia = []; activities.length = 0;
      alive = false; connection = null; window.removeEventListener('message', receive);
      for (const pending of exports.values()) { clearTimeout(pending.timer); pending.reject(new Error('剪辑工程已关闭')); }
      exports.clear();
      for (const pending of renders.values()) { clearTimeout(pending.timer); pending.reject(new Error('剪辑面板已关闭，后台导出仍可在工作台查看')); }
      renders.clear();
    };
  }, [props.chatPanel.projectId]);
}

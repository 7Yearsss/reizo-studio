import { useEffect, type RefObject } from 'react';
import type { VideoEditorWorkspace } from '../../../shared/videoEditor';
import { completeEditorMedia, editorMediaFile, editorMediaJobs, saveEditorExport, updateEditorContext, editorRenderRequest } from '../../api';
import { editorActivitySchema, editorContextSchema, type EditorActivity, type EditorContext } from '../../../shared/videoEditorContext';

export function useVideoMediaBridge(sessionId: string, workspace: VideoEditorWorkspace | null, frame: RefObject<HTMLIFrameElement | null>, report: (message: string) => void) {
  useEffect(() => {
    if (!workspace) return;
    const origin = new URL(workspace.url).origin;
    const nonce = crypto.randomUUID();
    let alive = true; let ready = false; let timer: ReturnType<typeof setTimeout>;
    let observation: { context: EditorContext; activities: EditorActivity[] } | null = null;
    const sent = new Set<string>();
    const saving = new Map<string, Promise<unknown>>();
    const post = (value: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ channel: 'reizo-media-v1', projectId: workspace.projectId, nonce, ...value }, origin);
    const loaded = () => { ready = false; sent.clear(); observation = null; };
    const element = frame.current;
    element?.addEventListener('load', loaded);
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || data?.channel !== 'reizo-media-v1' || data.nonce !== nonce || data.projectId !== workspace.projectId) return;
      if (data.type === 'ready') { ready = true; return; }
      if (data.type === 'render-request' && typeof data.id === 'string' && ['POST', 'GET', 'DELETE'].includes(data.method)) {
        const id = typeof data.renderId === 'string' ? data.renderId : undefined;
        if (data.method !== 'POST' && !id || data.method === 'POST' && id) return;
        // This request intentionally outlives the frame. Only the response is discarded on unmount.
        void editorRenderRequest(sessionId, data.method, id, data.method === 'POST' ? { projectId: workspace.projectId, body: data.body } : undefined)
          .then((result) => { if (alive) post({ type: 'render-result', id: data.id, result }); },
            (error) => { if (alive) post({ type: 'render-result', id: data.id, error: error.message }); });
        return;
      }
      if (data.type === 'context') {
        const context = editorContextSchema.safeParse(data.context);
        const activities = editorActivitySchema.array().max(30).safeParse(data.activities);
        if (context.success && activities.success && context.data.projectId === workspace.projectId) observation = { context: context.data, activities: activities.data };
        return;
      }
      if (data.type === 'import-result' && sent.has(data.id)) {
        void completeEditorMedia(sessionId, data.id, data.error ? { error: String(data.error).slice(0, 1000) } : { asset: data.asset })
          .catch((error) => report(error.message));
      }
      if (data.type === 'save-export' && typeof data.id === 'string' && typeof data.name === 'string' && data.blob instanceof Blob) {
        if (data.blob.size > 256 * 1024 * 1024) { post({ type: 'export-result', id: data.id, error: '成片超过 256 MB' }); return; }
        const purpose = data.purpose === 'source' ? 'source' : 'export';
        if (!saving.has(data.id)) saving.set(data.id, saveEditorExport(sessionId, workspace.projectId, data.name, data.blob, purpose));
        void saving.get(data.id)?.then((result) => {
          if (alive) { post({ type: 'export-result', id: data.id, result }); report(purpose === 'source' ? '素材已保存到当前画布和素材库「剪辑素材」（已有素材会复用）' : '成片已保存到当前画布和素材库「剪辑成片」'); }
        }, (error) => { if (alive) { post({ type: 'export-result', id: data.id, error: error.message }); report(`成片保存失败：${error.message}`); } });
      }
    };
    window.addEventListener('message', receive);
    const poll = async () => {
      try {
        post({ type: 'connect' });
        if (ready) {
          if (observation) {
            const next = observation; observation = null;
            await updateEditorContext(sessionId, next.context, next.activities);
          }
          const { jobs } = await editorMediaJobs(sessionId);
          for (const id of sent) if (!jobs.some((job) => job.id === id)) sent.delete(id);
          for (const job of jobs) {
            if (!alive || sent.has(job.id) || job.projectId !== workspace.projectId) continue;
            const blob = await editorMediaFile(sessionId, job.id);
            if (!alive) return;
            sent.add(job.id); post({ type: 'import', job, blob });
          }
        }
      } catch (error) { if (alive) report(error instanceof Error ? error.message : '素材通道连接失败'); }
      finally { if (alive) timer = setTimeout(() => void poll(), 1000); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('message', receive); element?.removeEventListener('load', loaded); };
  }, [sessionId, workspace, frame, report]);
}

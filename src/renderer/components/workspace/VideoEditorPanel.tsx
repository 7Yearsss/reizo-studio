import { useEffect, useRef, useState } from 'react';
import { Film, RefreshCw } from 'lucide-react';
import { editorApprovalMode, importEditorMedia, listEditorMedia, openVideoEditor } from '../../api';
import type { VideoEditorWorkspace } from '../../../shared/videoEditor';
import type { CanvasAsset } from '../../../shared/canvasAssets';
import { useVideoMediaBridge } from './useVideoMediaBridge';

export default function VideoEditorPanel({ sessionId }: { sessionId: string }) {
  const [workspace, setWorkspace] = useState<VideoEditorWorkspace | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [message, setMessage] = useState('');
  const [assets, setAssets] = useState<CanvasAsset[] | null>(null);
  const [importing, setImporting] = useState('');
  const [approval, setApproval] = useState<'manual' | 'auto'>('manual');
  const [savingApproval, setSavingApproval] = useState(false);
  const approvalSession = useRef(sessionId);
  approvalSession.current = sessionId;
  useEffect(() => {
    let alive = true;
    setApproval('manual'); setSavingApproval(true);
    void editorApprovalMode(sessionId).then(({ mode }) => { if (alive) setApproval(mode); })
      .catch((e) => { if (alive) setMessage(e.message); })
      .finally(() => { if (alive) setSavingApproval(false); });
    return () => { alive = false; };
  }, [sessionId]);
  useVideoMediaBridge(sessionId, workspace, frame, setMessage);
  useEffect(() => {
    let alive = true;
    setError(''); setWorkspace(null);
    void openVideoEditor(sessionId, attempt > 0).then((value) => { if (alive) setWorkspace(value); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : '剪辑工程打开失败'); });
    return () => { alive = false; };
  }, [sessionId, attempt]);
  if (!workspace) return <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
    <Film size={28} className="text-ink-muted" />
    <p role={error ? 'alert' : 'status'} className="max-w-sm text-sm text-ink-muted">{error || '正在准备剪辑工作台，首次打开需要一点时间…'}</p>
    {error && <button className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={14} />重试</button>}
  </div>;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-ink-muted">
      <span className="flex-1">{approval === 'auto' ? 'Agent 预览后自动应用后续剪辑修改，可用撤销恢复。' : 'Agent 修改等待确认；也可在对话中说“应用这一版”。'}</span>
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-ink" title="仅当前对话，预览后的后续剪辑提案自动应用；现有待审草稿仍需确认。">
        <input type="checkbox" aria-label="自动应用剪辑修改" checked={approval === 'auto'} disabled={savingApproval} onChange={(event) => {
          const mode = event.target.checked ? 'auto' : 'manual';
          setSavingApproval(true);
          void editorApprovalMode(sessionId, mode).then((value) => {
            if (approvalSession.current !== sessionId) return;
            setApproval(value.mode);
            setMessage(value.mode === 'auto' ? '已开启当前对话的自动应用。现有待审草稿仍需确认，后续提案预览后自动应用。' : '已切回手动确认，后续草稿等待你确认。');
          }).catch((e) => { if (approvalSession.current === sessionId) setMessage(e.message); })
            .finally(() => { if (approvalSession.current === sessionId) setSavingApproval(false); });
        }} />自动应用
      </label>
      <button className="shrink-0 text-ink" onClick={() => {
        if (assets) { setAssets(null); return; }
        void listEditorMedia(sessionId).then((result) => setAssets(result.assets)).catch((e) => setMessage(e.message));
      }}>工作台素材</button>
      <button title="重新连接剪辑工作台" aria-label="重新连接剪辑工作台" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={13} /></button>
    </div>
    {message && <p role="status" className="shrink-0 border-b border-line px-3 py-1 text-xs text-ink-muted">{message}</p>}
    {assets && <div className="max-h-48 shrink-0 overflow-auto border-b border-line p-3 text-xs">
      <p className="mb-2 text-ink-muted">当前对话的素材版本 · 导入后在下方素材池使用</p>
      {!assets.length && <p>当前对话暂无素材。可先在画布导入文件或复用素材库中的作品。</p>}
      {assets.map((asset) => <div key={asset.id} className="flex items-center gap-2 py-1">
        <span className="min-w-0 flex-1 truncate" title={asset.id}>{asset.name || asset.path.split('/').pop()} · {{ image: '图片', video: '视频', audio: '音频', mask: '蒙版' }[asset.kind]}{asset.generation ? ` · 第 ${asset.generation} 版` : ''} · {new Date(asset.createdAt).toLocaleString()}</span>
        <button className="shrink-0 rounded border border-line px-2 py-1 disabled:opacity-50" disabled={!!importing} onClick={() => {
          setImporting(asset.id); setMessage('正在传入剪辑素材池…');
          void importEditorMedia(sessionId, asset.id).then(() => setMessage('已加入剪辑素材池，可拖入时间线或交给 Agent 剪辑')).catch((e) => setMessage(e.message)).finally(() => setImporting(''));
        }}>{importing === asset.id ? '传输中…' : '加入剪辑'}</button>
      </div>)}
    </div>}
    <div className="min-h-0 flex-1 overflow-auto">
      <iframe ref={frame} key={`${workspace.projectId}:${attempt}`} title="视频剪辑工作台" src={workspace.url} className="h-full min-h-[480px] w-full min-w-[700px] border-0" allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" />
    </div>
  </div>;
}

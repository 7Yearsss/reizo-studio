import { useEffect, useState } from 'react';
import type { WorkspacePreview } from '../../../shared/filePreview';
import { readWorkspacePreview, workspaceMediaUrl } from '../../api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import FilePreview from './FilePreview';

export default function WorkspaceFileDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [preview, setPreview] = useState<WorkspacePreview | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setPreview(null); setUrl(''); setError('');
    void readWorkspacePreview(path).then(async result => {
      const mediaUrl = result.kind !== 'text' && result.kind !== 'unsupported' ? await workspaceMediaUrl(result.path) : '';
      if (current) { setPreview(result); setUrl(mediaUrl); }
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : '文件预览失败'); });
    return () => { current = false; };
  }, [path]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[85vh] flex-col gap-3 overflow-hidden rounded-2xl p-5 sm:max-w-[min(900px,calc(100vw-48px))]">
      <DialogTitle className="min-w-0 break-all pr-8 text-sm leading-6">{path.split(/[/\\]/).pop()}</DialogTitle>
      <DialogDescription className="break-all text-xs">{preview?.path ?? path}</DialogDescription>
      <div className="min-h-0 overflow-auto">
        {error ? <p role="alert" className="py-6 text-sm text-danger">{error}</p>
          : !preview ? <p role="status" className="py-6 text-sm text-ink-muted">正在打开预览…</p>
            : preview.kind === 'text' ? <>
              {preview.truncated && <p role="status" className="mb-2 text-xs text-ink-muted">文件较大，当前显示前段内容。</p>}
              <FilePreview path={preview.path} content={preview.content} />
            </> : preview.kind === 'image' ? <img src={url} alt={preview.path} className="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain" onError={() => setError('图片无法读取，请确认文件格式。')} />
              : preview.kind === 'video' ? <video src={url} controls playsInline preload="metadata" className="max-h-[65vh] w-full rounded-lg bg-black" onError={() => setError('此视频编码无法在应用中播放。')} />
                : preview.kind === 'audio' ? <audio src={url} controls preload="metadata" className="my-8 w-full" onError={() => setError('此音频编码无法在应用中播放。')} />
                  : <p className="py-6 text-sm text-ink-muted">此格式暂不支持内嵌预览，可在文件夹中查看。</p>}
      </div>
      {preview && <button type="button" className="chat-file-link self-start text-xs" onClick={() => { void window.reizo.revealInFolder(preview.path).catch(() => setError('无法打开文件夹')); }}>在文件夹中显示</button>}
    </DialogContent>
  </Dialog>;
}

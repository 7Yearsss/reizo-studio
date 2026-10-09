import { Plus, ImageIcon, Video, AudioLines, Workflow, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

interface CanvasEmptyPromptProps {
  onOpenAddModal: () => void;
  onCreateTextToVideo: () => void;
  onCreateImageNode: () => void;
  onCreateFirstFrameToVideo: () => void;
  onCreateAudioToVideo: () => void;
  onLoadTemplate: () => void;
  pending?: string | null;
  error?: string | null;
}

/** A first action and a few real starting points; these create graph structure, not model runs. */
export default function CanvasEmptyPrompt({ onOpenAddModal, onCreateTextToVideo, onCreateImageNode, onCreateFirstFrameToVideo, onCreateAudioToVideo, onLoadTemplate, pending, error }: CanvasEmptyPromptProps) {
  return (
    <div data-canvas-empty-prompt="true" aria-busy={Boolean(pending)} className="pointer-events-auto flex max-w-lg flex-col items-center gap-5 px-10 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium tracking-tight text-ink">从一个节点开始</h2>
        <p className="text-xs leading-6 text-ink-muted">连接文字、画面与声音，把每一步创作留在画布上。</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" disabled={Boolean(pending)} onClick={onOpenAddModal}><Plus data-icon="inline-start" />添加节点</Button>
        <Button type="button" variant="outline" size="sm" disabled={Boolean(pending)} onClick={onLoadTemplate}><Workflow data-icon="inline-start" />载入分镜模板</Button>
      </div>
      <div role="group" aria-label="快捷创建" className="flex flex-wrap items-center justify-center gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)} onClick={onCreateImageNode}><ImageIcon data-icon="inline-start" />图片</Button>
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)} onClick={onCreateTextToVideo}><Video data-icon="inline-start" />视频</Button>
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)} onClick={onCreateFirstFrameToVideo}><ImageIcon data-icon="inline-start" />首帧与视频</Button>
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)} onClick={onCreateAudioToVideo}><AudioLines data-icon="inline-start" />音频与视频</Button>
      </div>
      {pending ? <p role="status" className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />{pending}</p> : <p className="text-[11px] leading-5 text-ink-faint">双击空白处添加节点，也可以把图片拖到这里。</p>}
      {error ? <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  );
}

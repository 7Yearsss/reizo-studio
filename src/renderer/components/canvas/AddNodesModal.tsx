import { useRef, useState } from 'react';
import { Type, ImageIcon, Video, AudioLines, Bot, Film, Boxes, Upload, Scissors, Layers, Loader2, AlertCircle } from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';
import { CanvasCommandMenu, CanvasCommandGroup, CanvasCommandItem, CanvasCommandLabel, CanvasCommandSeparator } from './CanvasCommandMenu';
import { Alert, AlertDescription } from '../ui/alert';

export interface AddNodesModalProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onSelectType?: (type: CanvasNodeType, position: { x: number; y: number }, initialParams?: Record<string, unknown>) => void | Promise<unknown>;
  prepareType?: (type: CanvasNodeType, position: { x: number; y: number }, initialParams?: Record<string, unknown>) => () => Promise<unknown>;
  onUploadFile?: (file: File, position: { x: number; y: number }) => void;
  onOpenTimeline?: () => void;
  onOpen3DStudio?: () => void;
}

/** A direct creation palette for double-clicking blank canvas. */
export default function AddNodesModal({ x, y, flowX, flowY, onClose, onSelectType, prepareType, onUploadFile, onOpenTimeline, onOpen3DStudio }: AddNodesModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const preparedChoices = useRef(new Map<string, () => Promise<unknown>>());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = async (type: CanvasNodeType, initialParams?: Record<string, unknown>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (prepareType) {
        const key = JSON.stringify([type, initialParams]);
        let commit = preparedChoices.current.get(key);
        if (!commit) {
          commit = prepareType(type, { x: flowX, y: flowY }, initialParams);
          preparedChoices.current.set(key, commit);
        }
        await commit();
      } else {
        await onSelectType?.(type, { x: flowX, y: flowY }, initialParams);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) { onUploadFile?.(file, { x: flowX, y: flowY }); onClose(); }
      }} />
      <CanvasCommandMenu x={x} y={y} label="创建画布内容" onClose={onClose} className="w-60">
        <CanvasCommandGroup>
          <CanvasCommandLabel>添加节点</CanvasCommandLabel>
          <CanvasCommandItem icon={Type} label="文本便签" disabled={pending} keepOpen onAction={() => { void select('note'); }} />
          <CanvasCommandItem icon={ImageIcon} label="图片" disabled={pending} keepOpen onAction={() => { void select('image'); }} />
          <CanvasCommandItem icon={Video} label="视频" disabled={pending} keepOpen onAction={() => { void select('video'); }} />
          <CanvasCommandItem icon={AudioLines} label="音频" disabled={pending} keepOpen onAction={() => { void select('audio'); }} />
          <CanvasCommandItem icon={Bot} label="Agent" disabled={pending} keepOpen onAction={() => { void select('agent'); }} />
        </CanvasCommandGroup>
        <CanvasCommandSeparator />
        <CanvasCommandGroup>
          <CanvasCommandLabel>辅助工具</CanvasCommandLabel>
          <CanvasCommandItem icon={Film} label="串联审片" disabled={pending} onAction={() => onOpenTimeline?.()} />
          <CanvasCommandItem icon={Boxes} label="场景大区" disabled={pending} keepOpen={!onOpen3DStudio} onAction={() => { if (onOpen3DStudio) onOpen3DStudio(); else void select('section', { title: '场景大区' }); }} />
          <CanvasCommandItem icon={Scissors} label="提取首尾帧" disabled={pending} keepOpen onAction={() => { void select('frameExtractor'); }} />
        </CanvasCommandGroup>
        <CanvasCommandSeparator />
        <CanvasCommandGroup>
          <CanvasCommandLabel>添加资源</CanvasCommandLabel>
          <CanvasCommandItem icon={Upload} label="上传文件" disabled={pending} keepOpen onAction={() => fileInputRef.current?.click()} />
          <CanvasCommandItem icon={Layers} label="资产图钉" disabled={pending} keepOpen onAction={() => { void select('anchor', { role: 'character', label: '资产图钉' }); }} />
        </CanvasCommandGroup>
        {pending ? <div role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />正在创建节点…</div> : null}
        {error ? <Alert variant="destructive" className="mt-1"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
      </CanvasCommandMenu>
    </>
  );
}

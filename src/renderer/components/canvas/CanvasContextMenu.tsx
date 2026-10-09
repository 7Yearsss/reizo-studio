import { useRef, useState } from 'react';
import {
  Upload, Layers, Type, ImageIcon, Video, AudioLines, Bot, Film, Boxes,
  LayoutGrid, Scissors, Maximize, Play, PlayCircle, GitBranchPlus,
  MessagesSquare, AtSign, Copy, Trash2, Undo2, Redo2, Clipboard, Loader2, AlertCircle,
} from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';
import { EDIT_META, IMAGE_EDIT_KINDS, type ImageEditKind } from '../../../shared/canvasImageEdit';
import { CanvasCommandMenu, CanvasCommandGroup, CanvasCommandItem, CanvasCommandLabel, CanvasCommandSeparator } from './CanvasCommandMenu';
import { Alert, AlertDescription } from '../ui/alert';

export interface CanvasContextMenuProps {
  menu:
    | { kind: 'node'; x: number; y: number; nodeId: string }
    | { kind: 'pane'; x: number; y: number; flowX: number; flowY: number };
  onClose: () => void;
  onUploadClick?: () => void;
  onAddAssetClick?: () => void;
  onOpenAddNodesModal?: () => void;
  onAddNode?: (type: CanvasNodeType, initialParams?: Record<string, unknown>) => void | Promise<unknown>;
  prepareType?: (type: CanvasNodeType, initialParams?: Record<string, unknown>) => () => Promise<unknown>;
  onOpenTimeline?: () => void;
  onOpen3DStudio?: () => void;
  onTidyLayout?: () => void;
  onFitView?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canPaste?: boolean;
  onRunNode?: (nodeId: string) => void;
  onRunGraph?: (nodeId: string) => void;
  onForkNode?: (nodeId: string) => void;
  onAskAgent?: (nodeId: string) => void;
  onRefToComposer?: (nodeId: string) => void;
  onCopyNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  canEditImage?: boolean;
  onEditImage?: (nodeId: string, kind: ImageEditKind) => void;
}

export default function CanvasContextMenu(props: CanvasContextMenuProps) {
  const { menu, onClose, onAddNode } = props;
  const [page, setPage] = useState<'main' | 'nodes' | 'tools' | 'edit'>('main');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const nodeId = menu.kind === 'node' ? menu.nodeId : '';
  const back = page === 'main' ? undefined : () => setPage('main');
  const create = async (type: CanvasNodeType, params?: Record<string, unknown>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (props.prepareType) await props.prepareType(type, params)();
      else await onAddNode?.(type, params);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <CanvasCommandMenu x={menu.x} y={menu.y} label={menu.kind === 'pane' ? '画布操作' : '节点操作'} onClose={onClose} onBack={back} pageKey={page}>
      {page === 'nodes' ? (
        <CanvasCommandGroup>
          <CanvasCommandLabel>添加节点</CanvasCommandLabel>
          <CanvasCommandItem icon={Type} label="文本便签" disabled={pending} keepOpen onAction={() => { void create('note'); }} />
          <CanvasCommandItem icon={ImageIcon} label="图片" disabled={pending} keepOpen onAction={() => { void create('image'); }} />
          <CanvasCommandItem icon={Video} label="视频" disabled={pending} keepOpen onAction={() => { void create('video'); }} />
          <CanvasCommandItem icon={AudioLines} label="音频" disabled={pending} keepOpen onAction={() => { void create('audio'); }} />
          <CanvasCommandItem icon={Bot} label="Agent" disabled={pending} keepOpen onAction={() => { void create('agent'); }} />
        </CanvasCommandGroup>
      ) : page === 'tools' ? (
        <CanvasCommandGroup>
          <CanvasCommandLabel>辅助工具</CanvasCommandLabel>
          <CanvasCommandItem icon={Film} label="串联审片" onAction={() => props.onOpenTimeline?.()} />
          <CanvasCommandItem icon={Boxes} label="场景大区" disabled={pending} keepOpen={!props.onOpen3DStudio} onAction={() => { if (props.onOpen3DStudio) props.onOpen3DStudio(); else void create('section', { title: '场景大区' }); }} />
          <CanvasCommandItem icon={Scissors} label="提取首尾帧" disabled={pending} keepOpen onAction={() => { void create('frameExtractor'); }} />
          <CanvasCommandSeparator />
          <CanvasCommandItem icon={LayoutGrid} label="整理布局" onAction={() => props.onTidyLayout?.()} />
          <CanvasCommandItem icon={Maximize} label="适应全景" shortcut="F" onAction={() => props.onFitView?.()} />
        </CanvasCommandGroup>
      ) : page === 'edit' ? (
        <CanvasCommandGroup>
          <CanvasCommandLabel>派生图片编辑</CanvasCommandLabel>
          {IMAGE_EDIT_KINDS.map((kind) => <CanvasCommandItem key={kind} icon={ImageIcon} label={EDIT_META[kind].label} onAction={() => props.onEditImage?.(nodeId, kind)} />)}
        </CanvasCommandGroup>
      ) : menu.kind === 'pane' ? (
        <>
          <CanvasCommandGroup>
            <CanvasCommandItem icon={Upload} label="上传文件" onAction={() => props.onUploadClick?.()} />
            <CanvasCommandItem icon={Layers} label="添加资产图钉" disabled={pending} keepOpen={!props.onAddAssetClick} onAction={() => { if (props.onAddAssetClick) props.onAddAssetClick(); else void create('anchor', { role: 'character', label: '资产图钉' }); }} />
            <CanvasCommandItem icon={Type} label="添加节点" submenu keepOpen onAction={() => setPage('nodes')} />
            <CanvasCommandItem icon={Scissors} label="辅助工具" submenu keepOpen onAction={() => setPage('tools')} />
          </CanvasCommandGroup>
          <CanvasCommandSeparator />
          <CanvasCommandGroup>
            <CanvasCommandItem icon={Undo2} label="撤销" shortcut="Ctrl Z" disabled={!props.canUndo} onAction={() => props.onUndo?.()} />
            <CanvasCommandItem icon={Redo2} label="重做" shortcut="Ctrl Shift Z" disabled={!props.canRedo} onAction={() => props.onRedo?.()} />
            <CanvasCommandItem icon={Clipboard} label="粘贴" shortcut="Ctrl V" disabled={!props.canPaste} onAction={() => props.onPaste?.()} />
          </CanvasCommandGroup>
        </>
      ) : (
        <>
          <CanvasCommandGroup>
            <CanvasCommandItem icon={Play} label="运行这个节点" shortcut="R" onAction={() => props.onRunNode?.(nodeId)} />
            <CanvasCommandItem icon={PlayCircle} label="从这里往下运行" onAction={() => props.onRunGraph?.(nodeId)} />
            {props.canEditImage ? <CanvasCommandItem icon={ImageIcon} label="编辑图片" submenu keepOpen onAction={() => setPage('edit')} /> : null}
            <CanvasCommandItem icon={GitBranchPlus} label="派生变体分支" onAction={() => props.onForkNode?.(nodeId)} />
            <CanvasCommandItem icon={MessagesSquare} label="让 Agent 处理" onAction={() => props.onAskAgent?.(nodeId)} />
            <CanvasCommandItem icon={AtSign} label="引用到输入框" onAction={() => props.onRefToComposer?.(nodeId)} />
          </CanvasCommandGroup>
          <CanvasCommandSeparator />
          <CanvasCommandGroup>
            <CanvasCommandItem icon={Copy} label="复制节点" shortcut="Ctrl C" onAction={() => props.onCopyNode?.(nodeId)} />
            <CanvasCommandItem icon={Trash2} label="删除节点" shortcut="Delete" danger onAction={() => props.onDeleteNode?.(nodeId)} />
          </CanvasCommandGroup>
        </>
      )}
      {pending ? <div role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />正在创建节点…</div> : null}
      {error ? <Alert variant="destructive" className="mt-1"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </CanvasCommandMenu>
  );
}

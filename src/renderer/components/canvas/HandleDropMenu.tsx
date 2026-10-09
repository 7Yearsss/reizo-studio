import { useMemo, useRef, useState } from 'react';
import { Type, ImageIcon, Video, Volume2, GitBranchPlus, Loader2, AlertCircle, type LucideIcon } from 'lucide-react';
import { defaultNodeBox, type CanvasNode, type CanvasNodeType } from '../../../shared/canvas';
import { isPortCompatible } from '../../../shared/canvasGraph';
import * as canvasStore from '../../state/canvasStore';
import { Alert, AlertDescription } from '../ui/alert';
import { CanvasCommandMenu, CanvasCommandGroup, CanvasCommandItem, CanvasCommandLabel } from './CanvasCommandMenu';

export interface HandleDropIntent {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
  flowX: number;
  flowY: number;
  screenX: number;
  screenY: number;
  isDragDrop?: boolean;
}

interface CreationChoice {
  type: CanvasNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  title: string;
  params?: Record<string, unknown>;
}

export default function HandleDropMenu({ sessionId, intent, anchorNode, onClose, onCreated }: {
  sessionId: string;
  intent: HandleDropIntent;
  anchorNode?: CanvasNode;
  onClose: () => void;
  onCreated: (nodeId: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const preparedChoices = useRef(new Map<string, () => Promise<string>>());
  const [error, setError] = useState<string | null>(null);
  const backward = intent.handleType === 'target';
  const choices = useMemo<CreationChoice[]>(() => {
    const list: CreationChoice[] = [
      { type: 'note', label: '文本便签', description: backward ? '补充提示词或剧本文本' : '脚本、广告词与品牌文案', icon: Type, title: '提示词' },
      { type: 'image', label: backward ? '参考图片' : '图片', description: backward ? '接入画面参考' : '基于当前内容创建图片', icon: ImageIcon, title: backward ? '参考图' : '图片' },
      { type: 'video', label: backward ? '前序视频' : '视频', description: backward ? '接入前序镜头' : '首帧动效与运镜', icon: Video, title: backward ? '前序视频' : '视频生成', params: { prompt: '', duration: '5s', ratio: '16:9' } },
      { type: 'audio', label: backward ? '参考音频' : '音频', description: backward ? '接入音频轨道' : '台词与音频内容', icon: Volume2, title: '音频' },
    ];
    if (!backward && anchorNode?.type === 'image') {
      list.push({ type: 'image', label: '派生变体分支', description: '创建独立节点，保留当前图片', icon: GitBranchPlus, title: `${anchorNode.title || '图片'}（变体）`, params: { ...anchorNode.params } });
    }
    return list;
  }, [backward, anchorNode]);

  const create = async (choice: CreationChoice) => {
    if (pendingRef.current || !anchorNode) return;
    pendingRef.current = true;
    setPending(choice.label);
    setError(null);
    const box = defaultNodeBox(choice.type);
    const position = intent.isDragDrop
      ? { x: Math.round(intent.flowX - (backward ? box.w : 0)), y: Math.round(intent.flowY - box.h / 2) }
      : { x: Math.round(backward ? anchorNode.x - box.w - 120 : anchorNode.x + anchorNode.w + 140), y: Math.round(anchorNode.y) };
    const spec = { type: choice.type, ...position, title: choice.title, params: choice.params };
    try {
      let commit = preparedChoices.current.get(choice.label);
      if (!commit) {
        commit = canvasStore.prepareNodeCreation(sessionId, spec, backward
          ? { targetId: intent.nodeId, targetHandle: intent.handleId }
          : { sourceId: intent.nodeId, sourceHandle: intent.handleId, targetHandle: choice.type === 'note' ? 'text_in' : 'prompt' });
        preparedChoices.current.set(choice.label, commit);
      }
      const newId = await commit();
      if (!newId) throw new Error('未能创建节点，请稍后重试');
      onCreated(newId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试');
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  return (
    <CanvasCommandMenu x={intent.screenX} y={intent.screenY} label={backward ? '添加上游参考' : '引用该节点继续创作'} onClose={onClose} className="w-64">
      <CanvasCommandGroup>
        <CanvasCommandLabel>
          <span className="flex flex-col gap-1">
            <span>{backward ? '添加上游参考' : '引用该节点继续创作'}</span>
            <span className="truncate font-normal text-foreground">{anchorNode?.title || '当前节点'}</span>
          </span>
        </CanvasCommandLabel>
        {choices.map((choice) => {
          const candidate = anchorNode ? { ...anchorNode, id: 'new-node', type: choice.type } : undefined;
          const compatible = anchorNode && candidate
            ? backward ? isPortCompatible(candidate, anchorNode, null, intent.handleId) : isPortCompatible(anchorNode, candidate, intent.handleId)
            : { valid: false, reason: '原节点已不存在' };
          return <CanvasCommandItem key={choice.label} icon={choice.icon} label={choice.label} description={compatible.valid ? choice.description : compatible.reason} disabled={Boolean(pending) || !compatible.valid} keepOpen onAction={() => { void create(choice); }} />;
        })}
      </CanvasCommandGroup>
      {pending ? <div role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />正在创建{pending}…</div> : null}
      {error ? <Alert variant="destructive" className="mt-1"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </CanvasCommandMenu>
  );
}

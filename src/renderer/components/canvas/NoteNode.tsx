import { useEffect, useState, memo, useRef } from 'react';
import { NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { AlignLeft, Bot, Type } from 'lucide-react';
import type { CanvasNoteParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import FloatingNodeHeader from './FloatingNodeHeader';
import type { CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import MagneticHandle from './MagneticHandle';
import AgentMark from './AgentMark';

function NoteNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark, isProposal } = data as CanvasNodeData;
  const params = (node.params as CanvasNoteParams) || { content: '' };
  const [content, setContent] = useState(params.content || '');
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const { hovered, hoverProps } = useHoverIntent();

  useEffect(() => {
    setContent(params.content || '');
  }, [params.content]);

  const commitContent = () => {
    if (content === (params.content || '')) return;
    void canvasStore.updateNodeParams(sessionId, node.id, {
      ...params,
      content,
    });
  };

  const askAgentToExpand = () => {
    void chatStore.sendMessage(
      sessionId,
      `这是我在画布文本节点「${node.title || '剧本/提示词'}」中写的内容：\n“${content || '（暂无草稿内容）'}”\n\n请帮我将这段文本扩写为富于视听细节与画质描述的专业提示词，并保留适合分镜生成的节奏。`,
      [],
      {},
    );
  };

  return (
    <div
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-2.5 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />

      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border-accent !bg-paper"
        onResizeStart={(_, p: ResizeParams) => {
          resizeStart.current = { w: p.width, h: p.height };
        }}
        onResizeEnd={(_, p: ResizeParams) => {
          const from = resizeStart.current;
          resizeStart.current = null;
          if (from) canvasStore.commitResize(sessionId, id, from, { w: p.width, h: p.height });
        }}
      />

      {/* TapNow magnetic handles with elastic follow and click-to-create */}
      <MagneticHandle
        type="target"
        position={Position.Left}
        id="text_in"
        nodeId={node.id}
        kind="prompt"
        label="添加上下文"
        top="50%"
      />
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="prompt_out"
        nodeId={node.id}
        kind="prompt"
        label="引用该节点生成"
        top="50%"
      />

      {/* Floating anti-zoom header outside the card boundary (TapNow design) */}
      <FloatingNodeHeader
        sessionId={sessionId}
        nodeId={node.id}
        title={node.title}
        fallback="文本"
        icon={<Type size={13} className="text-emerald-400 shrink-0" />}
        selected={selected}
        hovered={hovered}
        badge={
          <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-400/90 select-none">
            {content.length} 字
          </span>
        }
      />

      {/* Body textarea - large prominent text area */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={commitContent}
          placeholder="输入提示词、分镜剧本、旁白台词或灵感文本…&#10;可拉出右侧端口连入下游生图、视频或音频节点。"
          className="nodrag h-full w-full resize-none rounded-lg border border-line/70 bg-paper-inset/40 p-2.5 text-xs text-ink placeholder:text-ink-muted/50 focus:border-accent focus:bg-paper-inset/70 focus:outline-none leading-relaxed transition-colors selection:bg-accent/20 font-sans"
        />
      </div>

      {/* Footer hint */}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-muted/70 px-0.5">
        <span className="truncate max-w-[65%] select-none">拉出右侧端点连入画面/视频 ➔</span>
        <button
          type="button"
          onClick={askAgentToExpand}
          className="nodrag flex items-center gap-1 text-accent hover:underline font-medium shrink-0"
        >
          <Bot size={11} />
          Agent 扩写
        </button>
      </div>
    </div>
  );
}

export default memo(NoteNode, (prev, next) => {
  const prevData = prev.data as CanvasNodeData;
  const nextData = next.data as CanvasNodeData;
  return (
    prev.selected === next.selected &&
    prev.width === next.width &&
    prev.height === next.height &&
    prevData.sessionId === nextData.sessionId &&
    prevData.highlighted === nextData.highlighted &&
    prevData.agentMark === nextData.agentMark &&
    prevData.isProposal === nextData.isProposal &&
    prevData.node === nextData.node
  );
});

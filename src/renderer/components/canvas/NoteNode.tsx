import { useEffect, useState, memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Bot, Copy, StickyNote, Trash2 } from 'lucide-react';
import type { CanvasNoteParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import AgentMark from './AgentMark';

const NOTE_COLORS: Array<{ id: NonNullable<CanvasNoteParams['color']>; bg: string; border: string; dot: string }> = [
  { id: 'amber', bg: 'bg-[#fef9c3]/85 dark:bg-[#713f12]/20', border: 'border-[#fde047] dark:border-[#854d0e]/60', dot: 'bg-amber-400' },
  { id: 'slate', bg: 'bg-paper-raised/95', border: 'border-line', dot: 'bg-zinc-400' },
  { id: 'rose', bg: 'bg-[#ffe4e6]/85 dark:bg-[#881337]/20', border: 'border-[#fecdd3] dark:border-[#9f1239]/60', dot: 'bg-rose-400' },
  { id: 'emerald', bg: 'bg-[#d1fae5]/85 dark:bg-[#064e3b]/20', border: 'border-[#a7f3d0] dark:border-[#065f46]/60', dot: 'bg-emerald-400' },
  { id: 'violet', bg: 'bg-[#ede9fe]/85 dark:bg-[#4c1d95]/20', border: 'border-[#ddd6fe] dark:border-[#5b21b6]/60', dot: 'bg-violet-400' },
];

function NoteNode({ data, selected }: NodeProps & { data: CanvasNodeData }) {
  const { sessionId, node, highlighted, agentMark } = data;
  const params = (node.params as CanvasNoteParams) || { content: '' };
  const [content, setContent] = useState(params.content || '');
  const color = params.color || 'amber';

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

  const currentColorConfig = NOTE_COLORS.find((c) => c.id === color) || NOTE_COLORS[0];

  const onResizeEnd = (_: unknown, p: ResizeParams) => {
    canvasStore.commitResize(sessionId, node.id, { w: node.w, h: node.h }, { w: p.width, h: p.height });
  };

  const askAgentToExpand = () => {
    void chatStore.sendMessage(
      sessionId,
      `这是我在画布便签「${node.title || '剧情大纲'}」中写的灵感草稿：\n“${content || '（暂无草稿内容）'}”\n\n请帮我将这段大纲扩写为富有视听感染力的分镜剧本，包含详细的画面视觉要素、色调风格与镜头运动建议。`,
      [],
      {},
    );
  };

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-2xl border p-3 shadow-xl backdrop-blur-md transition-all duration-200',
        currentColorConfig.bg,
        currentColorConfig.border,
        selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-paper' : '',
        highlighted ? 'scale-[1.02] ring-2 ring-accent' : '',
      )}
      style={{ width: node.w, height: node.h }}
    >
      <AgentMark show={agentMark} />
      <NodeResizer
        minWidth={220}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-accent/70"
        handleClassName="!size-2 !bg-accent !border-paper-raised !rounded-full"
        onResizeEnd={onResizeEnd}
      />

      {/* Floating Action Bar */}
      <div className="absolute -top-9 right-1 hidden items-center gap-1 rounded-xl border border-line bg-paper-raised/95 px-1.5 py-1 shadow-lg backdrop-blur-md group-hover:flex">
        <button
          type="button"
          onClick={askAgentToExpand}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink hover:bg-paper-inset transition-colors"
          title="让 Agent 扩写剧情与分镜"
        >
          <Bot size={11} className="text-accent" />
          扩写剧本
        </button>
        <button
          type="button"
          onClick={() => void canvasStore.duplicateNode(sessionId, node.id)}
          className="rounded p-1 text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
          title="复制便签"
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          onClick={() => void canvasStore.removeNode(sessionId, node.id)}
          className="rounded p-1 text-ink-muted hover:bg-danger/10 hover:text-danger transition-colors"
          title="删除"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line/40 pb-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink">
          <StickyNote size={14} className="text-accent shrink-0" />
          <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="剧本 / 灵感便签" />
        </div>

        {/* Color Palette Picker */}
        <div className="flex items-center gap-1 nodrag">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                void canvasStore.updateNodeParams(sessionId, node.id, {
                  ...params,
                  color: c.id,
                });
              }}
              className={cn(
                'size-3 rounded-full transition-transform',
                c.dot,
                color === c.id ? 'scale-125 ring-1 ring-ink/40' : 'opacity-60 hover:opacity-100 hover:scale-110',
              )}
              title={`切换色调: ${c.id}`}
            />
          ))}
        </div>
      </div>

      {/* Body textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={commitContent}
        placeholder="记录剧情大纲、分镜脚本、旁白台词或画面灵感…&#10;可拉出右侧端口连入下游生图/视频节点作为母本。"
        className="nodrag mt-2 min-h-0 flex-1 w-full resize-none bg-transparent text-xs text-ink placeholder:text-ink-muted/60 outline-none leading-relaxed"
      />

      {/* Footer hint */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-muted/70 pt-1 border-t border-line/30">
        <span>延伸输出端点 ➔</span>
        <button
          type="button"
          onClick={askAgentToExpand}
          className="nodrag flex items-center gap-1 text-accent hover:underline font-medium"
        >
          <Bot size={10} />
          Agent 扩写
        </button>
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="prompt_out"
        className="!size-2.5 !bg-accent !border-2 !border-paper-raised transition-transform hover:!scale-150"
        title="拖出连线注入下游生图/视频卡片"
      />
    </div>
  );
}

export default memo(NoteNode);

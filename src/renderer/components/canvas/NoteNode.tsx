import { useEffect, useState, useMemo, useCallback, memo, useRef } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { Type } from 'lucide-react';
import type { CanvasNoteParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as chatStore from '../../state/chatStore';
import { cn } from '../../lib/cn';
import FloatingNodeHeader from './FloatingNodeHeader';
import type { CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import { useIsSoloSelected } from './useSelectionCount';
import MagneticHandle from './MagneticHandle';
import AgentMark from './AgentMark';
import NodeCornerResizer from './NodeCornerResizer';
import NodeFloatingPanel, { type UpstreamSourceItem } from './NodeFloatingPanel';

function NoteNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, highlighted, agentMark, isProposal } = data as CanvasNodeData;
  const params = (node.params as CanvasNoteParams) || { content: '' };
  const [content, setContent] = useState(params.content || '');
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { hovered, hoverProps } = useHoverIntent();
  const solo = useIsSoloSelected(selected);
  const composing = useCanvasStore((s) => s.mentionComposerBySession[sessionId] === node.id);

  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);
  latestContentRef.current = content;

  useEffect(() => {
    const storeContent = params.content || '';
    if (storeContent === latestContentRef.current || contentDebounceRef.current !== null) return;
    setContent(storeContent);
    latestContentRef.current = storeContent;
  }, [params.content]);

  useEffect(() => {
    return () => {
      if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
    };
  }, []);

  // Exit editing when the node is deselected externally
  useEffect(() => {
    if (!selected && isEditing) {
      commitContent();
      setIsEditing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing) {
      const t = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [isEditing]);

  const commitContent = useCallback(() => {
    if (contentDebounceRef.current) {
      clearTimeout(contentDebounceRef.current);
      contentDebounceRef.current = null;
    }
    const freshNode = canvasStore.nodeById(sessionId, node.id);
    const freshParams = (freshNode?.params as Record<string, unknown>) ?? {};
    if (latestContentRef.current === (freshParams.content || '')) return;
    void canvasStore.updateNodeParams(sessionId, node.id, {
      ...freshParams,
      content: latestContentRef.current,
    });
  }, [sessionId, node.id]);

  const handleContentChange = useCallback((nextText: string) => {
    setContent(nextText);
    latestContentRef.current = nextText;
    if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
    contentDebounceRef.current = setTimeout(() => {
      contentDebounceRef.current = null;
      const freshNode = canvasStore.nodeById(sessionId, node.id);
      const freshParams = (freshNode?.params as Record<string, unknown>) ?? {};
      if (nextText === (freshParams.content || '')) return;
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...freshParams,
        content: nextText,
      });
    }, 400);
  }, [sessionId, node.id]);

  const handleBlur = () => {
    commitContent();
    setIsEditing(false);
  };

  const askAgentToExpand = () => {
    void chatStore.sendMessage(
      sessionId,
      `这是我在画布文本节点「${node.title || '剧本/提示词'}」中写的内容：\n"${content || '（暂无草稿内容）'}"\n\n请帮我将这段文本扩写为富于视听细节与画质描述的专业提示词，并保留适合分镜生成的节奏。`,
      [],
      {},
    );
  };

  const edges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);

  const upstreamSources = useMemo<UpstreamSourceItem[]>(() => {
    const inEdges = edges.filter((e) => e.targetId === node.id);
    return inEdges.map((e) => {
      const srcNode = allNodes.find((n) => n.id === e.sourceId);
      return {
        edgeId: e.id,
        sourceNodeId: e.sourceId,
        sourceType: srcNode?.type || 'node',
        sourceTitle:
          srcNode?.title ||
          (srcNode?.type === 'note'
            ? '提示词'
            : srcNode?.type === 'image'
              ? '参考图'
              : '节点'),
        handleId: e.targetHandle,
      };
    });
  }, [edges, allNodes, node.id]);

  const candidates = useMemo(() => {
    if (!solo && !composing) return [];
    const snapshot = canvasStore.getSnapshot().nodesBySession[sessionId] ?? [];
    return snapshot.filter((n) => n.id !== node.id && n.type !== 'anchor');
  }, [solo, composing, sessionId, node.id]);

  return (
    <div
      {...hoverProps}
      className={cn(
        'group relative flex h-full w-full flex-col rounded-2xl p-0 transition-all cursor-default select-none overflow-visible bg-paper-raised/95 dark:bg-[#18181b]/95 backdrop-blur-md shadow-sm',
        selected
          ? 'border-2 border-[#edd7a3] shadow-[0_0_12px_rgba(237,215,163,0.35)]'
          : 'border border-white/15 hover:border-white/30',
        highlighted && 'canvas-node-highlight',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      <AgentMark show={agentMark} />

      <NodeCornerResizer
        nodeId={node.id}
        sessionId={sessionId}
        hovered={hovered}
        minWidth={200}
        minHeight={140}
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
        nodeHovered={hovered || selected}
      />
      <MagneticHandle
        type="source"
        position={Position.Right}
        id="prompt_out"
        nodeId={node.id}
        kind="prompt"
        label="引用该节点生成"
        top="50%"
        nodeHovered={hovered || selected}
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

      {/* Pure & Clean Text Body (Single click to drag, double click to edit) */}
      <div className="relative flex-1 min-h-0 flex flex-col h-full w-full">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleBlur}
            placeholder="输入提示词、分镜剧本、旁白台词或灵感文本…"
            className="nodrag h-full w-full resize-none rounded-2xl bg-transparent p-3.5 text-xs text-ink placeholder:text-ink-muted/40 focus:outline-none leading-relaxed transition-colors selection:bg-accent/20 font-sans cursor-text"
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title="双击编辑文本 · 拖拽移动节点"
            className={cn(
              'h-full w-full rounded-2xl bg-transparent p-3.5 text-xs leading-relaxed font-sans overflow-auto select-none break-words whitespace-pre-wrap cursor-grab active:cursor-grabbing',
              content ? 'text-ink' : 'text-ink-muted/40',
            )}
          >
            {content || '输入提示词、分镜剧本、旁白台词或灵感文本…'}
          </div>
        )}
      </div>

      {/* TapNow floating generation panel for Note (AI expansion & mention helper) */}
      <NodeFloatingPanel
        sessionId={sessionId}
        node={node}
        visible={solo || composing}
        nodeType="note"
        prompt={content}
        onPromptChange={handleContentChange}
        onPromptCommit={commitContent}
        candidates={candidates}
        upstreamSources={upstreamSources}
        running={false}
        onRun={askAgentToExpand}
        onAgentExpand={askAgentToExpand}
      />
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

import { useCallback, memo, useMemo, useState } from 'react';
import { Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { Layers, Play, Unlink, Trash2, Maximize2, Sparkles, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { CanvasSubgraphParams, CanvasNodeType } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import NodeHandle from './NodeHandle';

function SubgraphNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, isProposal } = data as CanvasNodeData;
  const params = (node.params as CanvasSubgraphParams) || {};
  const innerNodeIds = params.innerNodeIds || [];
  const innerSnapshot = params.innerSnapshot;
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(params.description || '');

  const rf = useReactFlow();

  // Summary breakdown of inner node types
  const nodeBreakdown = useMemo(() => {
    const counts: Partial<Record<CanvasNodeType, number>> = {};
    if (innerSnapshot?.nodes) {
      for (const n of innerSnapshot.nodes) {
        counts[n.type] = (counts[n.type] || 0) + 1;
      }
    } else if (innerNodeIds.length > 0) {
      // If inner nodes are still in the active store session
      for (const nId of innerNodeIds) {
        const n = canvasStore.nodeById(sessionId, nId);
        if (n) counts[n.type] = (counts[n.type] || 0) + 1;
      }
    }
    return counts;
  }, [innerSnapshot, innerNodeIds, sessionId]);

  const totalCount = innerSnapshot?.nodes?.length ?? innerNodeIds.length;

  const handleRun = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void canvasStore.runSubgraph(sessionId, node.id);
    },
    [sessionId, node.id],
  );

  const handleUnpack = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void canvasStore.unpackSubgraph(sessionId, node.id);
    },
    [sessionId, node.id],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void canvasStore.removeNode(sessionId, node.id);
    },
    [sessionId, node.id],
  );

  const handleCommitDesc = useCallback(() => {
    setDescEditing(false);
    if (descDraft !== (params.description || '')) {
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...params,
        description: descDraft.trim(),
      });
    }
  }, [sessionId, node.id, params, descDraft]);

  const typeLabels: Partial<Record<CanvasNodeType, string>> = {
    image: '生图',
    video: '视频',
    agent: 'Agent',
    note: '便签',
    anchor: '锚点',
    frameExtractor: '抽帧',
    group: '分组',
  };

  const [hovered, setHovered] = useState(false);
  const expanded = Boolean(selected || hovered);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative flex h-full w-full flex-col rounded-2xl border bg-paper shadow-md transition-all duration-200 ${
        selected ? 'border-accent shadow-lg shadow-accent/10 ring-2 ring-accent/20' : 'border-line hover:border-line-focus'
      } ${isProposal ? 'border-dashed border-cyan-400 ring-2 ring-cyan-400/40 animate-pulse' : ''}`}
    >
      {/* Left Inbound Port */}
      <NodeHandle
        id="input"
        type="target"
        position={Position.Left}
        kind="default"
        label="输入"
        expanded={expanded}
        top="50%"
      />

      {/* Right Outbound Port */}
      <NodeHandle
        id="output"
        type="source"
        position={Position.Right}
        kind="default"
        label="输出"
        expanded={expanded}
        top="50%"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-line bg-paper-inset/40 px-3 py-2 rounded-t-2xl">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-500">
            <Layers size={13} />
          </div>
          <div className="font-medium text-xs text-ink truncate">
            <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="复合子图" />
          </div>
          <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500">
            {totalCount} 节点
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 nodrag">
          <button
            type="button"
            onClick={handleRun}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-accent hover:bg-paper-inset transition-colors"
            title="运行子图内部工作流"
          >
            <Play size={11} className="fill-current" />
          </button>
          <button
            type="button"
            onClick={handleUnpack}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-paper-inset transition-colors"
            title="解散子图，将内部节点展开回主画布"
          >
            <Unlink size={12} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors"
            title="删除子图"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col justify-between p-3 gap-2.5">
        {/* Description / Subtitle */}
        <div className="nodrag text-xs">
          {descEditing ? (
            <input
              type="text"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={handleCommitDesc}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitDesc();
                if (e.key === 'Escape') {
                  setDescDraft(params.description || '');
                  setDescEditing(false);
                }
              }}
              autoFocus
              placeholder="添加子图功能描述..."
              className="w-full rounded border border-line bg-paper-inset px-2 py-0.5 text-xs text-ink outline-none focus:border-accent"
            />
          ) : (
            <div
              onClick={() => setDescEditing(true)}
              className="cursor-pointer text-ink-muted hover:text-ink truncate text-[11px]"
              title="点击编辑子图说明"
            >
              {params.description?.trim() ? params.description : '+ 点击添加子图说明...'}
            </div>
          )}
        </div>

        {/* Nodes summary tags */}
        <div className="flex flex-wrap gap-1">
          {Object.entries(nodeBreakdown).map(([typeKey, count]) => {
            if (!count) return null;
            const label = typeLabels[typeKey as CanvasNodeType] || typeKey;
            return (
              <span
                key={typeKey}
                className="rounded-md border border-line/60 bg-paper-inset/60 px-1.5 py-0.5 text-[10px] text-ink-muted font-mono"
              >
                {count}× {label}
              </span>
            );
          })}
          {Object.keys(nodeBreakdown).length === 0 && (
            <span className="text-[10px] text-ink-muted italic">复合模块封装</span>
          )}
        </div>

        {/* Status footer */}
        <div className="flex items-center justify-between pt-1 border-t border-line/50 text-[10px] text-ink-muted">
          <div className="flex items-center gap-1">
            {node.runState === 'running' ? (
              <>
                <Loader2 size={11} className="animate-spin text-accent" />
                <span className="text-accent font-medium">执行中...</span>
              </>
            ) : node.runState === 'done' ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">已就绪</span>
              </>
            ) : node.runState === 'error' ? (
              <>
                <AlertCircle size={11} className="text-danger" />
                <span className="text-danger">报错</span>
              </>
            ) : (
              <>
                <Sparkles size={11} className="text-indigo-400" />
                <span>子图封装</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleUnpack}
            className="nodrag text-[10px] text-accent hover:underline font-medium"
          >
            展开为节点 ➔
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(SubgraphNode);

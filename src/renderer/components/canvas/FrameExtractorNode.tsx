import React, { memo, useEffect, useState } from 'react';
import { Position, type NodeProps, useStore } from '@xyflow/react';
import { Film, Scissors, Loader2, RefreshCw } from 'lucide-react';
import type { CanvasFrameExtractorParams } from '../../../shared/canvas';
import { canvasAssetUrl } from '../../api';
import * as canvasStore from '../../state/canvasStore';
import { useCanvasStore } from '../../state/useCanvasStore';
import NodeHandle from './NodeHandle';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import { useHoverIntent } from './NodeActionBar';
import { cn } from '../../lib/cn';

function useAssetUrl(rel: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rel) {
      setUrl(null);
      return;
    }
    let active = true;
    canvasAssetUrl(rel)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [rel]);
  return url;
}

function FrameExtractorNode({ id, data, selected }: NodeProps) {
  const { sessionId, node, isProposal } = data as CanvasNodeData;
  const isLowLOD = useStore((s) => s.transform[2] < 0.35);
  const isMoodboard = useCanvasStore((s) => s.moodboardBySession[sessionId] ?? false);
  const hideControls = isLowLOD || isMoodboard;

  const { hovered, hoverProps } = useHoverIntent();
  const expanded = selected || hovered;

  const params = (node?.params as CanvasFrameExtractorParams) || { mode: 'end' };
  const mode = params.mode ?? 'end';

  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetRel = node?.output?.assets?.[0];
  const assetUrl = useAssetUrl(assetRel);

  // Find incoming video edge
  const allNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const allEdges = useCanvasStore((s) => s.edgesBySession[sessionId] ?? canvasStore.EMPTY_EDGES);
  const inEdge = allEdges.find((e) => e.targetId === id);
  const upNode = inEdge ? allNodes.find((n) => n.id === inEdge.sourceId) : undefined;
  const hasUpstreamAsset = Boolean(upNode?.output?.assets?.[0]);

  if (!node) return null;

  const handleModeChange = (newMode: 'start' | 'end' | 'custom') => {
    void canvasStore.updateNodeParams(sessionId, id, {
      ...params,
      mode: newMode,
    });
  };

  const handleExtract = async () => {
    if (extracting) return;
    setError(null);
    setExtracting(true);
    try {
      await canvasStore.extractFrameForNode(sessionId, id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '抽帧失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div
      {...hoverProps}
      className={cn(
        'relative flex h-full w-full flex-col rounded-xl border bg-paper-raised p-2.5 text-xs shadow-sm transition-shadow',
        selected ? 'border-accent ring-1 ring-accent/20' : 'border-line',
        extracting && 'canvas-node-running',
        isProposal && 'border-dashed !border-2 !border-accent shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse-subtle',
      )}
    >
      {/* Target handle receives video from upstream */}
      <NodeHandle
        type="target"
        id="video_in"
        position={Position.Left}
        kind="video"
        label="视频源"
        expanded={expanded}
        top="50%"
      />

      {/* Source handle outputs extracted frame as image */}
      <NodeHandle
        type="source"
        id="frame_out"
        position={Position.Right}
        kind="startFrame"
        label="画面帧"
        expanded={expanded}
        top="50%"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1 min-w-0">
          <Scissors size={12} className="text-accent shrink-0" />
          <NodeTitle sessionId={sessionId} nodeId={id} title={node.title} fallback="抽帧适配" />
        </div>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.2 text-[9px] font-medium shrink-0',
            assetRel ? 'bg-success/15 text-success' : hasUpstreamAsset ? 'bg-accent/15 text-accent' : 'bg-paper-inset text-ink-muted',
          )}
        >
          {assetRel ? '已就绪' : hasUpstreamAsset ? '待抽取' : '等待上游'}
        </span>
      </div>

      {/* Frame Preview / Status Box */}
      <div className="relative flex-1 min-h-[60px] w-full overflow-hidden rounded-lg bg-paper-inset/70 border border-line/40 flex items-center justify-center">
        {assetUrl ? (
          <img
            src={assetUrl}
            alt="Extracted Frame"
            className="h-full w-full object-cover rounded-md select-none pointer-events-none"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-[10px] text-ink-muted text-center px-2">
            <Film size={18} className="opacity-40" />
            <span>{hasUpstreamAsset ? '已连视频，可提取帧' : '连接上游视频以抽帧'}</span>
          </div>
        )}

        {extracting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs text-white">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
      </div>

      {error ? <div className="mt-1 text-[9px] text-danger truncate">{error}</div> : null}

      {/* Controls */}
      {!hideControls && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-1">
            {/* Mode selection pills */}
            <div className="flex items-center rounded-md border border-line/60 bg-paper-inset/50 p-0.5 select-none">
              {(
                [
                  { id: 'end', label: '尾帧' },
                  { id: 'start', label: '首帧' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeChange(m.id)}
                  className={cn(
                    'nodrag rounded px-1.5 py-0.5 text-[10px] font-medium transition-all',
                    mode === m.id
                      ? 'bg-paper-raised text-ink border border-line/60 shadow-xs font-semibold dark:bg-white/15 dark:text-white dark:border-white/20'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Extract Trigger Button */}
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || !hasUpstreamAsset}
              className="nodrag inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-ink shadow-xs hover:opacity-90 disabled:opacity-40 transition-all active:scale-95"
              title={hasUpstreamAsset ? '从上游视频提取指定画面' : '请先确保上游视频已生成产物'}
            >
              <RefreshCw size={10} className={cn(extracting && 'animate-spin')} />
              {assetRel ? '重抽' : '提取'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(FrameExtractorNode);

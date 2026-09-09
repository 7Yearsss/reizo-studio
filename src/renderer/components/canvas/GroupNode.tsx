import { useCallback, useState, memo, useRef } from 'react';
import { NodeResizer, type NodeProps, type ResizeParams, useReactFlow } from '@xyflow/react';
import { Lock } from 'lucide-react';
import type { CanvasGroupParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { NodeTitle, type CanvasNodeData } from './ImageNode';
import { useIsSoloSelected } from './useSelectionCount';
import GroupToolbar from './GroupToolbar';

const GROUP_COLORS = [
  '#3b82f6', // Blue
  '#0d9488', // Teal
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#8b5cf6', // Violet
];

function GroupNode({ id, data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = (node.params as CanvasGroupParams) || { memberIds: [] };
  const memberIds = params.memberIds || [];
  const locked = params.locked ?? false;
  const currentColor = params.color || '#3b82f6';
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const resizeStart = useRef<{ w: number; h: number } | null>(null);
  const solo = useIsSoloSelected(selected);

  const rf = useReactFlow();

  const handleColorSelect = useCallback(
    (c: string) => {
      setColorPickerOpen(false);
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...params,
        color: c,
      });
    },
    [sessionId, node.id, params],
  );

  return (
    <div
      className="group relative flex h-full w-full flex-col rounded-2xl border transition-[border-color,box-shadow] duration-150"
      style={{
        borderColor: `${currentColor}66`,
        background: `${currentColor}0a`,
        boxShadow: selected ? `0 0 0 1px ${currentColor}, 0 4px 20px ${currentColor}1a` : undefined,
      }}
    >
      {solo ? (
        <GroupToolbar
          group={node}
          memberCount={memberIds.length}
          locked={locked}
          color={currentColor}
          onRun={() => canvasStore.runGroup(sessionId, node.id)}
          onFocus={() =>
            rf.fitBounds(
              { x: node.x, y: node.y, width: node.w, height: node.h },
              { duration: 400, padding: 0.15 },
            )
          }
          onFit={() => void canvasStore.refitGroup(sessionId, node.id)}
          onToggleLock={() =>
            void canvasStore.updateNodeParams(sessionId, node.id, { ...params, locked: !locked })
          }
          onUngroup={() => void canvasStore.ungroupNodes(sessionId, node.id)}
          onDelete={() => void canvasStore.removeNode(sessionId, node.id)}
        />
      ) : null}

      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected && !locked}
        lineClassName="!border-line/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-line !bg-paper"
        onResizeStart={(_, p: ResizeParams) => {
          resizeStart.current = { w: p.width, h: p.height };
        }}
        onResizeEnd={(_, p: ResizeParams) => {
          const from = resizeStart.current;
          resizeStart.current = null;
          if (from) canvasStore.commitResize(sessionId, id, from, { w: p.width, h: p.height });
        }}
      />

      {/* Header bar */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 rounded-t-2xl border-b select-none backdrop-blur-xs"
        style={{
          borderColor: `${currentColor}22`,
          background: `${currentColor}14`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0 cursor-pointer"
            style={{ backgroundColor: currentColor }}
            onClick={(e) => {
              e.stopPropagation();
              setColorPickerOpen((v) => !v);
            }}
            title="点击切换分组主题色"
          />
          <NodeTitle sessionId={sessionId} nodeId={node.id} title={node.title} fallback="分组容器" />
          <span
            className="rounded px-1.5 py-0.2 text-[9px] font-medium"
            style={{ color: currentColor, backgroundColor: `${currentColor}20` }}
          >
            {memberIds.length} 成员
          </span>
          {locked ? (
            <Lock size={11} className="text-amber-500 shrink-0" aria-label="已锁定" />
          ) : null}
        </div>
      </div>

      {/* Color picker popup */}
      {colorPickerOpen && (
        <div
          className="nodrag absolute top-9 left-3 z-50 flex gap-1 rounded-lg border border-line bg-paper-raised p-1.5 shadow-xl backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleColorSelect(c)}
              className="h-4 w-4 rounded-full border border-black/20 transition-transform hover:scale-125"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      {/* Body: transparent interior so underlying nodes can be interacted with directly */}
      <div className="flex-1 pointer-events-none" />
    </div>
  );
}

export default memo(GroupNode, (prev, next) => {
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

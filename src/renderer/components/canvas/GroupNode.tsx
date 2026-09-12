import { useCallback, useState, memo, useRef, useEffect } from 'react';
import { type NodeProps, useReactFlow, useStore } from '@xyflow/react';
import { Lock } from 'lucide-react';
import type { CanvasGroupParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import type { CanvasNodeData } from './ImageNode';
import { useIsSoloSelected } from './useSelectionCount';
import GroupToolbar from './GroupToolbar';
import NodeCornerResizer from './NodeCornerResizer';

function GroupNode({ id, data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = (node.params as CanvasGroupParams) || { memberIds: [] };
  const memberIds = params.memberIds || [];
  const locked = params.locked ?? false;
  const currentColor = params.color || '#3b82f6';
  const solo = useIsSoloSelected(selected);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title || '新建组');
  const inputRef = useRef<HTMLInputElement>(null);

  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: 1 / zoom, clamped safely to keep title legible at low zoom
  const titleScale = Math.min(8, Math.max(1, 1 / zoom));

  useEffect(() => {
    setDraft(node.title || '新建组');
  }, [node.title]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    const finalTitle = trimmed || '新建组';
    if (finalTitle !== node.title) {
      void canvasStore.renameNode(sessionId, node.id, finalTitle);
    }
  }, [draft, node.id, node.title, sessionId]);

  const handleColorSelect = useCallback(
    (c: string) => {
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...params,
        color: c,
      });
    },
    [sessionId, node.id, params],
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative h-full w-full rounded-[20px] transition-[border-color,box-shadow] duration-150 backdrop-blur-xs"
      style={{
        borderWidth: '1.5px',
        borderStyle: 'solid',
        borderColor: selected
          ? 'rgba(255, 255, 255, 0.4)'
          : 'var(--group-container-border, rgba(255, 255, 255, 0.12))',
        backgroundColor: 'var(--group-container-bg, rgba(30, 30, 35, 0.75))',
        boxShadow: selected
          ? '0 0 0 1px rgba(255, 255, 255, 0.15), 0 8px 32px rgba(0, 0, 0, 0.45)'
          : '0 4px 20px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Drag surface for moving the entire group and its members */}
      <div className="absolute inset-0 cursor-grab active:cursor-grabbing rounded-[20px]" />

      {/* Title positioned above the top-left edge with anti-zoom LOD scaling (matching FloatingNodeHeader) */}
      <div
        className="nodrag absolute bottom-[calc(100%+6px)] left-1 z-20 flex items-center gap-1.5 pointer-events-auto select-none whitespace-nowrap"
        style={{
          transform: `scale(${titleScale})`,
          transformOrigin: 'bottom left',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="请输入标题"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setDraft(node.title || '新建组');
                setEditing(false);
              }
            }}
            className="nodrag cursor-text rounded border border-accent/60 bg-paper-raised px-1.5 py-0.5 text-xs font-medium text-ink outline-none shadow-sm ring-1 ring-accent/30"
            style={{ minWidth: '100px' }}
          />
        ) : (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="group/title flex items-center gap-1.5 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 select-none"
            title="点击编辑组标题"
          >
            <span className="text-xs font-semibold text-ink/90 group-hover/title:text-ink transition-colors tracking-tight truncate max-w-[240px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
              {node.title?.trim() || '新建组'}
            </span>
            {locked ? (
              <span title="已锁定">
                <Lock size={12} className="text-amber-400 shrink-0" />
              </span>
            ) : null}
          </div>
        )}
      </div>

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
          onColorChange={handleColorSelect}
        />
      ) : null}

      {/* Resize controls matching ImageNode's 4 corner curved arc handles */}
      {!locked && (
        <NodeCornerResizer
          nodeId={node.id}
          sessionId={sessionId}
          hovered={Boolean(selected || hovered)}
          minWidth={240}
          minHeight={160}
        />
      )}
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

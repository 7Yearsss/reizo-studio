import React, { useMemo } from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';
import { CheckSquare, MessageSquarePlus, FolderPlus, Play, Trash2 } from 'lucide-react';
import type { CanvasNode } from '../../../shared/canvas';

export interface MultiSelectToolbarProps {
  sessionId: string;
  selectedNodes: CanvasNode[];
  onAddToChat: () => void;
  onGroup: () => void;
  onRunSelected: () => void;
  onDelete: () => void;
}

/**
 * TapNow-style Multiselect Floating Toolbar.
 *
 * When multiple nodes are selected via Marquee drag or Shift-click,
 * floats a collective toolbar directly above the selection bounding box:
 * [✓ 已选 N 个 | 💬 加入对话 | 📦 编组 | ⚡ 运行选中 | 🗑 删除]
 */
export default function MultiSelectToolbar({
  selectedNodes,
  onAddToChat,
  onGroup,
  onRunSelected,
  onDelete,
}: MultiSelectToolbarProps) {
  const zoom = useStore((s) => s.transform[2]) || 1;
  const scale = Math.min(3, Math.max(1, 1 / zoom));

  const bounds = useMemo(() => {
    if (selectedNodes.length <= 1) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of selectedNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 260));
      maxY = Math.max(maxY, n.y + (n.h || 180));
    }

    return {
      centerX: (minX + maxX) / 2,
      topY: minY - 14,
      count: selectedNodes.length,
    };
  }, [selectedNodes]);

  if (!bounds) {
    return null;
  }

  return (
    <ViewportPortal>
      <div
        className="nodrag cursor-default absolute z-30 flex items-center gap-1 rounded-xl border border-line/90 bg-[#18181b]/95 px-1.5 py-1 text-ink shadow-2xl backdrop-blur-md whitespace-nowrap animate-in fade-in zoom-in-95 duration-150 select-none"
        style={{
          left: `${bounds.centerX}px`,
          top: `${bounds.topY}px`,
          transform: `translate(-50%, -100%) scale(${scale})`,
          transformOrigin: 'bottom center',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center gap-1 px-1.5 text-[11px] font-medium text-ink-muted border-r border-line/60 pr-2 mr-0.5">
          <CheckSquare size={12} className="text-accent" />
          已选 {bounds.count} 个节点
        </span>
        <button
          type="button"
          onClick={onAddToChat}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="将选中节点作为多模态上下文引用加入对话输入框"
        >
          <MessageSquarePlus size={13} className="text-accent" />
          <span>加入对话</span>
        </button>
        <button
          type="button"
          onClick={onGroup}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="将选中节点打包为编组 (Ctrl+G)"
        >
          <FolderPlus size={13} className="text-sky-400" />
          <span>编组</span>
        </button>
        <button
          type="button"
          onClick={onRunSelected}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="批量执行选中的待跑节点"
        >
          <Play size={12} className="text-emerald-400" />
          <span>运行选中</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-danger/20 text-danger cursor-pointer transition-colors"
          title="删除选中节点 (Delete / Backspace)"
        >
          <Trash2 size={13} />
          <span>删除</span>
        </button>
      </div>
    </ViewportPortal>
  );
}

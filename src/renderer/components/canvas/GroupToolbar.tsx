import { useState } from 'react';
import { useStore } from '@xyflow/react';
import { Play, Crosshair, Frame, Lock, Unlock, Unlink, Trash2, LayoutGrid } from 'lucide-react';
import type { CanvasNode } from '../../../shared/canvas';

export const GROUP_COLORS = [
  '#3b82f6', // Blue
  '#0d9488', // Teal
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#8b5cf6', // Violet
  '#64748b', // Slate
];

export interface GroupToolbarProps {
  group: CanvasNode;
  memberCount: number;
  locked: boolean;
  color: string;
  onRun: () => void;
  onFocus: () => void;
  onFit: () => void;
  onToggleLock: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onColorChange?: (color: string) => void;
}

/**
 * Floating action pill for a selected `group` node — sits just above the group's
 * bounding box with inverse-scale compensation matching FloatingNodeHeader,
 * carrying whole-group actions.
 */
export default function GroupToolbar({
  group,
  locked,
  color,
  onRun,
  onFocus,
  onFit,
  onToggleLock,
  onUngroup,
  onDelete,
  onColorChange,
}: GroupToolbarProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]) || 1;
  // Inverse scale: 1 / zoom, clamped safely to keep crisp physical size
  const scale = Math.min(6, Math.max(1, 1 / zoom));
  const screenY = (group.y || 0) * zoom + ty;
  // If near screen top, place below the group
  const placeBelow = screenY < 60;

  return (
    <div
      className="nodrag cursor-default absolute z-30 flex items-center gap-1 rounded-full border border-white/12 bg-[#1c1c20]/95 px-2.5 py-1 text-white shadow-2xl backdrop-blur-md whitespace-nowrap select-none pointer-events-auto transition-[opacity,transform] duration-75"
      style={
        placeBelow
          ? {
              left: '50%',
              top: `calc(100% + ${10 * scale}px)`,
              transform: `translateX(-50%) scale(${scale})`,
              transformOrigin: 'top center',
            }
          : {
              left: '50%',
              bottom: `calc(100% + ${10 * scale}px)`,
              transform: `translateX(-50%) scale(${scale})`,
              transformOrigin: 'bottom center',
            }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* Color picker toggle dot */}
      <div className="relative flex items-center pl-0.5 pr-1.5">
        <button
          type="button"
          onClick={() => setColorPickerOpen((v) => !v)}
          className="h-3.5 w-3.5 rounded-full transition-transform hover:scale-125 cursor-pointer ring-2 ring-white/20 hover:ring-white/50"
          style={{ backgroundColor: color }}
          title="切换组主题色"
        />

        {/* Color palette popover */}
        {colorPickerOpen && (
          <div
            className="absolute bottom-full left-0 mb-2 flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#1c1c20]/95 p-2 shadow-2xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColorPickerOpen(false);
                  onColorChange?.(c);
                }}
                className="h-4 w-4 rounded-full transition-transform hover:scale-125 cursor-pointer"
                style={{
                  backgroundColor: c,
                  boxShadow: c === color ? `0 0 0 2px #1c1c20, 0 0 0 3.5px ${c}` : undefined,
                }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      <LayoutGrid size={13} className="text-white/50 shrink-0 mr-0.5" />

      <div className="h-3.5 w-px bg-white/15 mx-0.5" />

      <button
        type="button"
        onClick={onRun}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15 transition-colors cursor-pointer"
        title="按连线依赖顺序执行组内所有待跑节点"
      >
        <Play size={12} className="fill-emerald-400 text-emerald-400" />
        <span>整组执行</span>
      </button>

      <button
        type="button"
        onClick={onFit}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="收拢边框贴合当前成员"
      >
        <Frame size={12} className="text-white/60" />
        <span>整理</span>
      </button>

      <button
        type="button"
        onClick={onFocus}
        className="inline-flex items-center justify-center rounded-full p-1.5 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="居中聚焦到本组"
      >
        <Crosshair size={13} className="text-sky-400/90" />
      </button>

      <button
        type="button"
        onClick={onToggleLock}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title={locked ? '解锁组 (允许单独移动成员)' : '锁定组 (固定成员相对位置)'}
      >
        {locked ? (
          <Lock size={12} className="text-amber-400" />
        ) : (
          <Unlock size={12} className="text-white/60" />
        )}
        <span>{locked ? '已锁定' : '锁定'}</span>
      </button>

      <button
        type="button"
        onClick={onUngroup}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        title="解散组 (保留成员节点)"
      >
        <Unlink size={12} className="text-white/60" />
        <span>解组</span>
      </button>

      <div className="h-3.5 w-px bg-white/15 mx-0.5" />

      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center justify-center rounded-full p-1 text-white/60 hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
        title="删除组容器 (保留成员节点)"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

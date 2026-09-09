import { ViewportPortal, useStore } from '@xyflow/react';
import { Play, Crosshair, Frame, Lock, Unlock, Unlink, Trash2 } from 'lucide-react';
import type { CanvasNode } from '../../../shared/canvas';

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
}

/**
 * Floating action pill for a selected `group` node — the grouped-state
 * counterpart of {@link MultiSelectToolbar}. Sits just above the group's
 * bounding box, anti-zoom compensated, and carries the whole-group actions
 * (run / focus / lock / ungroup / delete) so the container header only needs
 * to show identity.
 */
export default function GroupToolbar({
  group,
  memberCount,
  locked,
  color,
  onRun,
  onFocus,
  onFit,
  onToggleLock,
  onUngroup,
  onDelete,
}: GroupToolbarProps) {
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]) || 1;
  const scale = Math.min(3, Math.max(1, 1 / zoom));
  // Flip below the group header when there isn't room for the bar above the
  // viewport's top edge (same trick Figma/tldraw use for selection toolbars).
  const screenY = group.y * zoom + ty;
  const placeBelow = screenY < 56;

  return (
    <ViewportPortal>
      <div
        className="nodrag cursor-default absolute z-30 flex items-center gap-1 rounded-xl border border-line/90 bg-[#18181b]/95 px-1.5 py-1 text-ink shadow-2xl backdrop-blur-md whitespace-nowrap animate-in fade-in zoom-in-95 duration-150 select-none"
        style={{
          left: `${group.x + group.w / 2}px`,
          top: `${placeBelow ? group.y + 44 : group.y - 14}px`,
          transform: `translate(-50%, ${placeBelow ? '0' : '-100%'}) scale(${scale})`,
          transformOrigin: placeBelow ? 'top center' : 'bottom center',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center gap-1.5 px-1.5 text-[11px] font-medium text-ink-muted border-r border-line/60 pr-2 mr-0.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          {group.title?.trim() || '新建组'}
          <span className="text-ink-muted/60">· {memberCount} 成员</span>
        </span>
        <button
          type="button"
          onClick={onRun}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="按连线依赖顺序执行组内所有待跑节点"
        >
          <Play size={12} className="fill-current text-emerald-400" />
          <span>整组执行</span>
        </button>
        <button
          type="button"
          onClick={onFocus}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="居中聚焦到本组"
        >
          <Crosshair size={12} className="text-sky-400" />
          <span>聚焦</span>
        </button>
        <button
          type="button"
          onClick={onFit}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="收拢边框贴合当前成员（增删成员后用）"
        >
          <Frame size={12} className="text-ink-muted" />
          <span>整理</span>
        </button>
        <button
          type="button"
          onClick={onToggleLock}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title={locked ? '解锁组 (允许单独移动成员)' : '锁定组 (固定成员相对位置)'}
        >
          {locked ? (
            <Lock size={12} className="text-amber-400" />
          ) : (
            <Unlock size={12} className="text-ink-muted" />
          )}
          <span>{locked ? '已锁定' : '锁定'}</span>
        </button>
        <button
          type="button"
          onClick={onUngroup}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-white/10 text-ink cursor-pointer transition-colors"
          title="解散组 (保留成员节点)"
        >
          <Unlink size={12} className="text-ink-muted" />
          <span>解组</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-danger/20 text-danger cursor-pointer transition-colors"
          title="删除组容器 (保留成员节点)"
        >
          <Trash2 size={12} />
          <span>删除组</span>
        </button>
      </div>
    </ViewportPortal>
  );
}

import { useCallback, useState, memo, useMemo } from 'react';
import { NodeResizer, type NodeProps, type ResizeParams, useReactFlow } from '@xyflow/react';
import { Maximize2, Trash2, Play, Palette, FolderKanban } from 'lucide-react';
import type { CanvasSectionParams } from '../../../shared/canvas';
import * as canvasStore from '../../state/canvasStore';
import { NodeTitle, type CanvasNodeData } from './ImageNode';

export const SECTION_THEMES: Record<
  NonNullable<CanvasSectionParams['color']>,
  { hex: string; bg: string; border: string; label: string }
> = {
  slate: { hex: '#64748b', bg: '#64748b0a', border: '#64748b40', label: '灰白' },
  amber: { hex: '#f59e0b', bg: '#f59e0b0a', border: '#f59e0b40', label: '琥珀' },
  blue: { hex: '#3b82f6', bg: '#3b82f60a', border: '#3b82f640', label: '深蓝' },
  emerald: { hex: '#10b981', bg: '#10b9810a', border: '#10b98140', label: '翡翠' },
  violet: { hex: '#8b5cf6', bg: '#8b5cf60a', border: '#8b5cf640', label: '紫罗兰' },
  rose: { hex: '#f43f5e', bg: '#f43f5e0a', border: '#f43f5e40', label: '玫瑰' },
};

function SectionNode({ id, data, selected }: NodeProps) {
  const { sessionId, node } = data as CanvasNodeData;
  const params = (node.params as CanvasSectionParams) || {};
  const currentColorKey = params.color || 'blue';
  const theme = SECTION_THEMES[currentColorKey] || SECTION_THEMES.blue;
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(params.description || '');

  const rf = useReactFlow();

  // Find member count
  const memberIds = useMemo(() => {
    return canvasStore.containerMemberIds(sessionId, node.id);
  }, [sessionId, node.id]);

  const handleColorSelect = useCallback(
    (c: CanvasSectionParams['color']) => {
      setColorPickerOpen(false);
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...params,
        color: c,
      });
    },
    [sessionId, node.id, params],
  );

  const handleCommitDesc = useCallback(() => {
    setEditingDesc(false);
    if (descDraft !== (params.description || '')) {
      void canvasStore.updateNodeParams(sessionId, node.id, {
        ...params,
        description: descDraft.trim(),
      });
    }
  }, [sessionId, node.id, params, descDraft]);

  const handleFocus = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      rf.fitBounds(
        { x: node.x, y: node.y, width: node.w, height: node.h },
        { duration: 450, padding: 0.15 },
      );
    },
    [rf, node],
  );

  const handleRunSection = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void canvasStore.runSection(sessionId, node.id);
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

  return (
    <div
      className="group relative flex h-full w-full flex-col rounded-3xl border-2 transition-all duration-200"
      style={{
        borderColor: selected ? theme.hex : theme.border,
        background: theme.bg,
        boxShadow: selected
          ? `0 0 0 1px ${theme.hex}, 0 8px 32px ${theme.hex}25`
          : `0 4px 20px ${theme.hex}10`,
      }}
    >
      <NodeResizer
        minWidth={320}
        minHeight={240}
        isVisible={selected}
        lineClassName="!border-line/60"
        handleClassName="!h-2.5 !w-2.5 !rounded-md !border-line !bg-paper"
        onResizeEnd={(_, p: ResizeParams) => {
          canvasStore.commitResize(
            sessionId,
            id,
            { w: node.w, h: node.h },
            { w: p.width, h: p.height },
          );
        }}
      />

      {/* Header Bar */}
      <div
        className="flex flex-col gap-1 px-4 py-2.5 rounded-t-3xl border-b select-none backdrop-blur-md"
        style={{
          borderColor: `${theme.hex}25`,
          background: `${theme.hex}18`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-lg text-white shadow-xs cursor-pointer transition-transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: theme.hex }}
              onClick={(e) => {
                e.stopPropagation();
                setColorPickerOpen((v) => !v);
              }}
              title="切换分区主题色"
            >
              <FolderKanban size={13} />
            </div>

            <div className="font-semibold text-sm tracking-wide text-ink">
              <NodeTitle
                sessionId={sessionId}
                nodeId={node.id}
                title={node.title}
                fallback="场景分区"
              />
            </div>

            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                color: theme.hex,
                backgroundColor: `${theme.hex}20`,
              }}
            >
              {memberIds.length} 个节点
            </span>
          </div>

          {/* Action icons */}
          <div className="flex items-center gap-1 shrink-0 nodrag">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setColorPickerOpen((v) => !v);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-paper-inset transition-colors"
              title="切换颜色主题"
            >
              <Palette size={13} />
            </button>

            <button
              type="button"
              onClick={handleFocus}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-paper-inset transition-colors"
              title="聚焦并居中此场景大区"
            >
              <Maximize2 size={13} />
            </button>

            {memberIds.length > 0 && (
              <button
                type="button"
                onClick={handleRunSection}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-paper-inset transition-colors"
                title="运行本场景内所有节点"
              >
                <Play size={12} className="fill-current text-accent" />
              </button>
            )}

            <button
              type="button"
              onClick={handleDelete}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors"
              title="删除分区外框 (保留内部节点)"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Scene Description Subtitle */}
        <div className="nodrag text-xs mt-0.5">
          {editingDesc ? (
            <input
              type="text"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={handleCommitDesc}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitDesc();
                if (e.key === 'Escape') {
                  setDescDraft(params.description || '');
                  setEditingDesc(false);
                }
              }}
              autoFocus
              placeholder="输入场景描述（如：雨夜霓虹街头，主角撑伞走过积水路面）..."
              className="w-full rounded-md border border-line bg-paper px-2 py-0.5 text-xs text-ink outline-none focus:border-accent"
            />
          ) : (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setEditingDesc(true);
              }}
              className="cursor-pointer truncate text-ink-muted/80 hover:text-ink hover:underline decoration-dotted"
              title="点击编辑场景描述"
            >
              {params.description?.trim() ? params.description : '+ 点击添加场景描述...'}
            </div>
          )}
        </div>
      </div>

      {/* Color Palette Popover */}
      {colorPickerOpen && (
        <div
          className="nodrag absolute top-12 left-4 z-50 flex gap-1.5 rounded-xl border border-line bg-paper-raised p-2 shadow-2xl backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(SECTION_THEMES) as Array<NonNullable<CanvasSectionParams['color']>>).map(
            (key) => {
              const t = SECTION_THEMES[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleColorSelect(key)}
                  className="group/btn relative flex flex-col items-center gap-1"
                  title={t.label}
                >
                  <span
                    className="h-5 w-5 rounded-full border border-black/20 transition-transform group-hover/btn:scale-125"
                    style={{ backgroundColor: t.hex }}
                  />
                  <span className="text-[9px] text-ink-muted">{t.label}</span>
                </button>
              );
            },
          )}
        </div>
      )}

      {/* Transparent Body allowing full interaction with nested nodes */}
      <div className="flex-1 pointer-events-none" />
    </div>
  );
}

export default memo(SectionNode);

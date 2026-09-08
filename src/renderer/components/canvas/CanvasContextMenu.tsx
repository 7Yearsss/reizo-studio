import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Layers,
  ChevronRight,
  AlignLeft,
  ImageIcon,
  Video,
  AudioLines,
  Box,
  Film,
  Orbit,
  LayoutGrid,
  Scissors,
  Maximize,
  Play,
  PlayCircle,
  GitBranchPlus,
  MessagesSquare,
  AtSign,
  Copy,
  Trash2,
} from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';
import { cn } from '../../lib/cn';

export interface CanvasContextMenuProps {
  menu:
    | { kind: 'node'; x: number; y: number; nodeId: string }
    | { kind: 'pane'; x: number; y: number; flowX: number; flowY: number };
  onClose: () => void;
  // Pane operations
  onUploadClick?: () => void;
  onAddAssetClick?: () => void;
  onOpenAddNodesModal?: () => void;
  onAddNode?: (type: CanvasNodeType, initialParams?: Record<string, unknown>) => void;
  onOpenTimeline?: () => void;
  onOpen3DStudio?: () => void;
  onTidyLayout?: () => void;
  onFitView?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canPaste?: boolean;
  // Node operations
  onRunNode?: (nodeId: string) => void;
  onRunGraph?: (nodeId: string) => void;
  onForkNode?: (nodeId: string) => void;
  onAskAgent?: (nodeId: string) => void;
  onRefToComposer?: (nodeId: string) => void;
  onCopyNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export default function CanvasContextMenu({
  menu,
  onClose,
  onUploadClick,
  onAddAssetClick,
  onOpenAddNodesModal,
  onAddNode,
  onOpenTimeline,
  onOpen3DStudio,
  onTidyLayout,
  onFitView,
  onUndo,
  onRedo,
  onPaste,
  canUndo = false,
  canRedo = false,
  canPaste = true,
  onRunNode,
  onRunGraph,
  onForkNode,
  onAskAgent,
  onRefToComposer,
  onCopyNode,
  onDeleteNode,
}: CanvasContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<'none' | 'nodes' | 'tools'>('none');
  const [submenuTop, setSubmenuTop] = useState<number>(0);

  // Close on outside click or Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 40);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Position clamping for menu
  const menuWidth = 200;
  const menuHeight = menu.kind === 'pane' ? 280 : 260;
  const left = Math.max(12, Math.min(menu.x, window.innerWidth - menuWidth - 12));
  const top = Math.max(12, Math.min(menu.y, window.innerHeight - menuHeight - 12));

  // Determine if submenu should open to the left if close to right edge
  const openSubmenuToLeft = left + menuWidth + 200 > window.innerWidth;

  return (
    <div
      ref={containerRef}
      className="fixed z-[180] flex flex-col rounded-2xl border border-white/[0.08] bg-[#18181b]/95 p-1.5 text-xs shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-100 select-none cursor-default"
      style={{ left, top, minWidth: menuWidth }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {menu.kind === 'pane' ? (
        <>
          {/* 上传 */}
          <button
            type="button"
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => {
              onUploadClick?.();
              onClose();
            }}
            className="group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]"
          >
            <span className="text-xs font-normal">上传</span>
          </button>

          {/* 添加资产 */}
          <button
            type="button"
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => {
              onAddAssetClick?.();
              onClose();
            }}
            className="group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]"
          >
            <span className="text-xs font-normal">添加资产</span>
          </button>

          {/* 添加节点 ▶ */}
          <div
            className="relative"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSubmenuTop(rect.top - top);
              setActiveSubmenu('nodes');
            }}
          >
            <button
              type="button"
              onClick={() => {
                onOpenAddNodesModal?.();
                onClose();
              }}
              className={cn(
                'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]',
                activeSubmenu === 'nodes' && 'bg-white/[0.08] text-white',
              )}
            >
              <span className="text-xs font-normal">添加节点</span>
              <ChevronRight size={14} className="text-zinc-400 group-hover:text-white transition-colors" />
            </button>

            {/* Submenu for Nodes */}
            {activeSubmenu === 'nodes' && (
              <div
                className={cn(
                  'absolute z-[190] flex w-48 flex-col rounded-2xl border border-white/[0.08] bg-[#18181b]/98 p-1.5 text-xs shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-100',
                  openSubmenuToLeft ? 'right-full mr-1.5' : 'left-full ml-1.5',
                )}
                style={{ top: 0 }}
              >
                {/* 文本 */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('note');
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <AlignLeft size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">文本</span>
                </button>

                {/* 图片 */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('image');
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <ImageIcon size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">图片</span>
                </button>

                {/* 视频 */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('video');
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <Video size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">视频</span>
                </button>

                {/* 音频 (带蓝点) */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('audio');
                    onClose();
                  }}
                  className="group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <AudioLines size={14} className="text-zinc-400 group-hover:text-white" />
                    <span className="text-xs font-normal">音频</span>
                  </div>
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                </button>

                {/* 3D (带蓝点) */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('agent', { title: '3D 概念生成', instruction: '生成 3D 资产与多视角预览' });
                    onClose();
                  }}
                  className="group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Box size={14} className="text-zinc-400 group-hover:text-white" />
                    <span className="text-xs font-normal">3D</span>
                  </div>
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                </button>
              </div>
            )}
          </div>

          {/* 添加辅助工具 ▶ */}
          <div
            className="relative"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSubmenuTop(rect.top - top);
              setActiveSubmenu('tools');
            }}
          >
            <button
              type="button"
              className={cn(
                'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]',
                activeSubmenu === 'tools' && 'bg-white/[0.08] text-white',
              )}
            >
              <span className="text-xs font-normal">添加辅助工具</span>
              <ChevronRight size={14} className="text-zinc-400 group-hover:text-white transition-colors" />
            </button>

            {/* Submenu for Tools */}
            {activeSubmenu === 'tools' && (
              <div
                className={cn(
                  'absolute z-[190] flex w-52 flex-col rounded-2xl border border-white/[0.08] bg-[#18181b]/98 p-1.5 text-xs shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-100',
                  openSubmenuToLeft ? 'right-full mr-1.5' : 'left-full ml-1.5',
                )}
                style={{ top: 0 }}
              >
                {/* 剪辑时间线 (Beta) */}
                <button
                  type="button"
                  onClick={() => {
                    onOpenTimeline?.();
                    onClose();
                  }}
                  className="group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Film size={14} className="text-zinc-400 group-hover:text-white" />
                    <span className="text-xs font-normal">剪辑时间线</span>
                  </div>
                  <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-white/60">Beta</span>
                </button>

                {/* 3D 片场 / 场景大区 */}
                <button
                  type="button"
                  onClick={() => {
                    onOpen3DStudio?.();
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <Orbit size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">3D 片场</span>
                </button>

                {/* 提取首尾帧 */}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode?.('frameExtractor');
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <Scissors size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">提取首尾帧</span>
                </button>

                {/* 整理布局 */}
                <button
                  type="button"
                  onClick={() => {
                    onTidyLayout?.();
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <LayoutGrid size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">整理布局</span>
                </button>

                {/* 适应视图 */}
                <button
                  type="button"
                  onClick={() => {
                    onFitView?.();
                    onClose();
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  <Maximize size={14} className="text-zinc-400 group-hover:text-white" />
                  <span className="text-xs font-normal">适应视图</span>
                </button>
              </div>
            )}
          </div>

          {/* 分割线 */}
          <div className="my-1 h-px bg-white/[0.08]" />

          {/* 撤销 CtrlZ */}
          <button
            type="button"
            disabled={!canUndo}
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => {
              if (canUndo) {
                onUndo?.();
                onClose();
              }
            }}
            className={cn(
              'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors',
              canUndo
                ? 'text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]'
                : 'text-zinc-500 cursor-not-allowed opacity-50',
            )}
          >
            <span className="text-xs font-normal">撤销</span>
            <span className="font-mono text-[11px] text-zinc-500 tracking-tight">CtrlZ</span>
          </button>

          {/* 重做 ShiftCtrlZ */}
          <button
            type="button"
            disabled={!canRedo}
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => {
              if (canRedo) {
                onRedo?.();
                onClose();
              }
            }}
            className={cn(
              'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors',
              canRedo
                ? 'text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]'
                : 'text-zinc-500 cursor-not-allowed opacity-50',
            )}
          >
            <span className="text-xs font-normal">重做</span>
            <span className="font-mono text-[11px] text-zinc-500 tracking-tight">ShiftCtrlZ</span>
          </button>

          {/* 粘贴 CtrlV */}
          <button
            type="button"
            disabled={!canPaste}
            onMouseEnter={() => setActiveSubmenu('none')}
            onClick={() => {
              onPaste?.();
              onClose();
            }}
            className={cn(
              'group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors',
              canPaste
                ? 'text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer active:scale-[0.99]'
                : 'text-zinc-500 cursor-not-allowed opacity-50',
            )}
          >
            <span className="text-xs font-normal">粘贴</span>
            <span className="font-mono text-[11px] text-zinc-500 tracking-tight">CtrlV</span>
          </button>
        </>
      ) : (
        /* Node Context Menu */
        <>
          <button
            type="button"
            onClick={() => {
              if (onRunNode && menu.nodeId) onRunNode(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <Play size={14} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-normal">运行这个节点</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onRunGraph && menu.nodeId) onRunGraph(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <PlayCircle size={14} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-normal">从这里往下运行</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onForkNode && menu.nodeId) onForkNode(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <GitBranchPlus size={14} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-normal">派生变体分支</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onAskAgent && menu.nodeId) onAskAgent(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <MessagesSquare size={14} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-normal">让 Agent 处理</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onRefToComposer && menu.nodeId) onRefToComposer(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <AtSign size={14} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-normal">引用到输入框</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onCopyNode && menu.nodeId) onCopyNode(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Copy size={14} className="text-zinc-400 group-hover:text-white" />
              <span className="text-xs font-normal">克隆节点</span>
            </div>
            <span className="font-mono text-[11px] text-zinc-500 tracking-tight">CtrlC</span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={() => {
              if (onDeleteNode && menu.nodeId) onDeleteNode(menu.nodeId);
              onClose();
            }}
            className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
          >
            <Trash2 size={14} />
            <span className="text-xs font-normal">删除节点</span>
          </button>
        </>
      )}
    </div>
  );
}

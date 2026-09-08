import React, { useRef, useEffect } from 'react';
import {
  AlignLeft,
  ImageIcon,
  Video,
  AudioLines,
  Box,
  Film,
  Orbit,
  Upload,
} from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';

export interface AddNodesModalProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onSelectType: (type: CanvasNodeType, position: { x: number; y: number }, initialParams?: Record<string, unknown>) => void;
  onUploadFile?: (file: File, position: { x: number; y: number }) => void;
  onOpenTimeline?: () => void;
  onOpen3DStudio?: () => void;
}

/**
 * Modern AI Canvas "Add Nodes" floating menu card:
 * - Triggered by double-clicking on canvas blank area or clicking empty prompt
 * - Sections: 添加节点 (Add Node), 辅助工具 (Auxiliary Tools), 添加资源 (Add Resources)
 * - Sleek dark glassmorphism card matching modern AI canvas aesthetic
 */
export default function AddNodesModal({
  x,
  y,
  flowX,
  flowY,
  onClose,
  onSelectType,
  onUploadFile,
  onOpenTimeline,
  onOpen3DStudio,
}: AddNodesModalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const openedAt = Date.now();
    const handleClickOutside = (e: MouseEvent) => {
      if (Date.now() - openedAt < 350) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // Delay adding click listener so the triggering double-click doesn't instantly close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 350);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Adjust card position to stay fully on screen
  const menuWidth = 270;
  const menuHeight = 520;
  const centeredLeft = x > window.innerWidth / 3 && x < (window.innerWidth * 2) / 3 ? x - menuWidth / 2 : x;
  const left = Math.max(16, Math.min(centeredLeft, window.innerWidth - menuWidth - 16));
  const top = Math.max(16, Math.min(y, window.innerHeight - menuHeight - 16));

  const handleSelect = (type: CanvasNodeType, initialParams?: Record<string, unknown>) => {
    onSelectType(type, { x: flowX, y: flowY }, initialParams);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) {
      onUploadFile(file, { x: flowX, y: flowY });
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[180] flex w-[270px] flex-col rounded-2xl border border-white/[0.08] bg-[#18181b]/95 p-2 text-xs shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 1. 添加节点 */}
      <div className="px-2.5 pt-1.5 pb-1 text-xs font-normal text-white/50 tracking-wide">
        添加节点
      </div>

      <div className="flex flex-col gap-0.5">
        {/* 文本 */}
        <button
          type="button"
          onClick={() => handleSelect('note')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <AlignLeft size={16} strokeWidth={2.2} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-zinc-100 group-hover:text-white">文本</span>
            <span className="text-[10px] text-zinc-400/80 truncate">脚本、广告词、品牌文案</span>
          </div>
        </button>

        {/* 图片 */}
        <button
          type="button"
          onClick={() => handleSelect('image')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <ImageIcon size={16} strokeWidth={2} />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">图片</span>
        </button>

        {/* 视频 */}
        <button
          type="button"
          onClick={() => handleSelect('video')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <Video size={16} strokeWidth={2} />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">视频</span>
        </button>

        {/* 音频 (带蓝点标识) */}
        <button
          type="button"
          onClick={() => handleSelect('audio')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <AudioLines size={16} strokeWidth={2} />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-sky-400 ring-2 ring-[#18181b]" />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">音频</span>
        </button>

        {/* 3D (带蓝点标识) */}
        <button
          type="button"
          onClick={() => handleSelect('agent', { title: '3D 概念生成', instruction: '生成 3D 资产与多视角预览' })}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <Box size={16} strokeWidth={2} />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-sky-400 ring-2 ring-[#18181b]" />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">3D</span>
        </button>
      </div>

      {/* 2. 辅助工具 */}
      <div className="mt-2.5 px-2.5 pt-1 pb-1 text-xs font-normal text-white/50 tracking-wide">
        辅助工具
      </div>

      <div className="flex flex-col gap-0.5">
        {/* 剪辑时间线 (Beta) */}
        <button
          type="button"
          onClick={() => {
            if (onOpenTimeline) onOpenTimeline();
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <Film size={16} strokeWidth={2} />
          </div>
          <div className="flex items-center">
            <span className="text-xs font-medium text-zinc-100 group-hover:text-white">剪辑时间线</span>
            <span className="ml-2 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-white/60">Beta</span>
          </div>
        </button>

        {/* 3D 片场 */}
        <button
          type="button"
          onClick={() => {
            if (onOpen3DStudio) {
              onOpen3DStudio();
            } else {
              handleSelect('section', { title: '3D 片场', description: '场景多机位与空间编排' });
            }
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <Orbit size={16} strokeWidth={2} />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">3D 片场</span>
        </button>
      </div>

      {/* 3. 添加资源 */}
      <div className="mt-2.5 px-2.5 pt-1 pb-1 text-xs font-normal text-white/50 tracking-wide">
        添加资源
      </div>

      <div className="flex flex-col gap-0.5">
        {/* 上传 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#27272a] text-zinc-200 group-hover:bg-[#323236] group-hover:text-white transition-colors">
            <Upload size={16} strokeWidth={2} />
          </div>
          <span className="text-xs font-medium text-zinc-100 group-hover:text-white">上传</span>
        </button>
      </div>
    </div>
  );
}

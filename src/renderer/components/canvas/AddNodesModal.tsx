import React, { useRef, useEffect } from 'react';
import {
  Type,
  ImageIcon,
  Video,
  Volume2,
  FolderKanban,
  Upload,
} from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';

export interface AddNodesModalProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onSelectType: (type: CanvasNodeType, position: { x: number; y: number }) => void;
  onUploadFile?: (file: File, position: { x: number; y: number }) => void;
}

/**
 * TapNow-style "Add Nodes" floating menu card (screenshot 30-dblclick-add-menu.png):
 * - Triggered by double-clicking on canvas blank area
 * - Categorized: Basic Nodes, Utilities, Add Source
 * - Sleek dark glassmorphism card with subtitles
 */
export default function AddNodesModal({
  x,
  y,
  flowX,
  flowY,
  onClose,
  onSelectType,
  onUploadFile,
}: AddNodesModalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // Delay adding click listener so the triggering double-click doesn't instantly close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Adjust card position to stay fully on screen
  const menuWidth = 260;
  const menuHeight = 380;
  const left = Math.max(16, Math.min(x, window.innerWidth - menuWidth - 16));
  const top = Math.max(16, Math.min(y, window.innerHeight - menuHeight - 16));

  const handleSelect = (type: CanvasNodeType) => {
    onSelectType(type, { x: flowX, y: flowY });
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
      className="fixed z-[180] flex w-[260px] flex-col rounded-2xl border border-line/60 bg-[#161618]/95 p-2 text-xs shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
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

      {/* Header */}
      <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-muted/70 tracking-wide">
        Add Nodes
      </div>

      {/* Primary Nodes */}
      <div className="flex flex-col gap-0.5">
        {/* Text */}
        <button
          type="button"
          onClick={() => handleSelect('note')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 transition-colors">
            <Type size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Text</span>
            <span className="text-[10px] text-ink-muted truncate">Script, Ad copy, Brand text</span>
          </div>
        </button>

        {/* Image */}
        <button
          type="button"
          onClick={() => handleSelect('image')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 group-hover:bg-indigo-500/25 transition-colors">
            <ImageIcon size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Image</span>
            <span className="text-[10px] text-ink-muted truncate">生图与画面参考</span>
          </div>
        </button>

        {/* Video */}
        <button
          type="button"
          onClick={() => handleSelect('video')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 group-hover:bg-rose-500/25 transition-colors">
            <Video size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Video</span>
            <span className="text-[10px] text-ink-muted truncate">视频生成与运镜</span>
          </div>
        </button>

        {/* Audio */}
        <button
          type="button"
          onClick={() => handleSelect('audio')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
            <Volume2 size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Audio</span>
            <span className="text-[10px] text-ink-muted truncate">配乐与声音生成</span>
          </div>
        </button>
      </div>

      {/* Utilities Section */}
      <div className="my-1 border-t border-line/40 px-2.5 pt-2 pb-0.5 text-[10px] font-medium text-ink-muted/60 tracking-wider uppercase">
        Utilities
      </div>

      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => handleSelect('section')}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400 group-hover:bg-blue-500/25 transition-colors">
            <FolderKanban size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Section</span>
            <span className="text-[10px] text-ink-muted truncate">场景大区分组管理</span>
          </div>
        </button>
      </div>

      {/* Add Source Section */}
      <div className="my-1 border-t border-line/40 px-2.5 pt-2 pb-0.5 text-[10px] font-medium text-ink-muted/60 tracking-wider uppercase">
        Add Source
      </div>

      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-ink group-hover:bg-white/20 transition-colors">
            <Upload size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">Upload</span>
            <span className="text-[10px] text-ink-muted truncate">导入本地图片、视频或音频</span>
          </div>
        </button>
      </div>
    </div>
  );
}

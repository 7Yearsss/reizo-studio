import React, { useRef, useEffect } from 'react';
import { Type, ImageIcon, Video, Volume2 } from 'lucide-react';
import type { CanvasNodeType } from '../../../shared/canvas';

export interface HandleCreateMenuProps {
  sourceNodeId: string;
  sourceNodeTitle?: string;
  handleType: 'source' | 'target';
  screenX: number;
  screenY: number;
  onClose: () => void;
  onSelect: (type: CanvasNodeType) => void;
}

/**
 * TapNow-style "Generate from this node" menu (screenshot 32-right-plus-menu.png):
 * - Triggered by clicking the plus handle on the right or left of a node
 * - Downstream: Text Generation, Image Generation, Video Generation, Audio
 * - Upstream: Text, Image, Video, Audio
 */
export default function HandleCreateMenu({
  sourceNodeTitle,
  handleType,
  screenX,
  screenY,
  onClose,
  onSelect,
}: HandleCreateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isRight = handleType === 'source';

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
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const menuWidth = 240;
  const menuHeight = 260;
  const left = Math.max(16, Math.min(screenX, window.innerWidth - menuWidth - 16));
  const top = Math.max(16, Math.min(screenY, window.innerHeight - menuHeight - 16));

  return (
    <div
      ref={menuRef}
      className="fixed z-[180] flex w-[240px] flex-col rounded-2xl border border-line/60 bg-[#161618]/95 p-2 text-xs shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-muted/70">
        <span>{isRight ? 'Generate from this node' : 'Input to this node'}</span>
        {sourceNodeTitle ? (
          <span className="text-[10px] text-accent/80 truncate max-w-[80px]">
            {sourceNodeTitle}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5 mt-1">
        {/* Text */}
        <button
          type="button"
          onClick={() => {
            onSelect('note');
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 transition-colors">
            <Type size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">
              {isRight ? 'Text Generation' : 'Text / 提示词'}
            </span>
            <span className="text-[10px] text-ink-muted truncate">
              {isRight ? 'Script, Ad copy, Brand text' : '提供提示词或剧本文本'}
            </span>
          </div>
        </button>

        {/* Image */}
        <button
          type="button"
          onClick={() => {
            onSelect('image');
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 group-hover:bg-indigo-500/25 transition-colors">
            <ImageIcon size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">
              {isRight ? 'Image Generation' : 'Image / 参考图'}
            </span>
            <span className="text-[10px] text-ink-muted truncate">
              {isRight ? '基于上游画面或提示词生图' : '提供首帧或画面参考'}
            </span>
          </div>
        </button>

        {/* Video */}
        <button
          type="button"
          onClick={() => {
            onSelect('video');
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 group-hover:bg-rose-500/25 transition-colors">
            <Video size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">
              {isRight ? 'Video Generation' : 'Video / 前序视频'}
            </span>
            <span className="text-[10px] text-ink-muted truncate">
              {isRight ? '首帧动效与运镜生成' : '作为前序镜头继续接戏'}
            </span>
          </div>
        </button>

        {/* Audio */}
        <button
          type="button"
          onClick={() => {
            onSelect('audio');
            onClose();
          }}
          className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
            <Volume2 size={14} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-ink group-hover:text-white">
              {isRight ? 'Audio' : 'Audio / 配乐'}
            </span>
            <span className="text-[10px] text-ink-muted truncate">
              {isRight ? '配乐与声音生成' : '提供背景音频轨道'}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

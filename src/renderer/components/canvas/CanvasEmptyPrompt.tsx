import React from 'react';
import { motion } from 'motion/react';
import { Video, Sparkles, Music2 } from 'lucide-react';

interface CanvasEmptyPromptProps {
  onOpenAddModal: () => void;
  onCreateTextToVideo: () => void;
  onCreateImageNode: () => void;
  onCreateFirstFrameToVideo: () => void;
  onCreateAudioToVideo: () => void;
  onLoadTemplate: () => void;
}

/**
 * TapNow-style ultra-clean floating canvas empty state:
 * - Direct floating pill bar on top of the dotted canvas background
 * - Top guide pill: "[✨ 双击] 画布自由生成,或查看模板"
 * - Bottom action pills: 文字生视频, 图片换背景, 首帧生成视频, 音频生视频, 模板
 */
export default function CanvasEmptyPrompt({
  onOpenAddModal,
  onCreateTextToVideo,
  onCreateImageNode,
  onCreateFirstFrameToVideo,
  onCreateAudioToVideo,
  onLoadTemplate,
}: CanvasEmptyPromptProps) {
  const handleTriggerModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenAddModal();
  };

  return (
    <motion.div
      data-canvas-empty-prompt="true"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto flex flex-col items-center gap-3 select-none cursor-default"
      onDoubleClick={handleTriggerModal}
      onContextMenu={(e) => {
        e.preventDefault();
        handleTriggerModal(e);
      }}
    >
      {/* Top hint pill */}
      <div
        onClick={handleTriggerModal}
        onDoubleClick={handleTriggerModal}
        className="flex items-center gap-2.5 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-md border border-white/10 shadow-lg cursor-pointer hover:border-white/25 hover:bg-black/70 transition-all"
        title="右键或双击画布空白处添加节点"
      >
        <button
          type="button"
          onClick={handleTriggerModal}
          onDoubleClick={handleTriggerModal}
          className="group flex items-center gap-1.5 rounded-lg bg-[#27272a] px-2.5 py-1 text-xs font-medium text-white/95 border border-white/10 shadow-sm hover:bg-[#323238] hover:border-white/20 active:scale-95 transition-all cursor-pointer"
        >
          {/* Custom shiny cursor / sparkle icon */}
          <div className="relative flex items-center justify-center">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-cyan-400 group-hover:scale-110 transition-transform"
            >
              <path d="M4 4l7.07 17 2.51-7.39L21 11.07 4 4z" />
              <path d="M2 2l1.5 1.5" />
              <path d="M8 1v2" />
              <path d="M1 8h2" />
            </svg>
          </div>
          <span>右键 / 双击</span>
        </button>

        <span className="text-xs text-zinc-300/90 hover:text-zinc-100 transition-colors tracking-wide">
          画布自由生成,或查看模板
        </span>
      </div>

      {/* Bottom action pills */}
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {/* 文字生视频 */}
        <button
          type="button"
          onClick={onCreateTextToVideo}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-[#161618]/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md hover:border-white/25 hover:bg-[#222226] hover:text-white active:scale-95 transition-all cursor-pointer"
        >
          <Video size={14} className="text-zinc-400 group-hover:text-white transition-colors" />
          <span>文字生视频</span>
        </button>

        {/* 图片换背景 */}
        <button
          type="button"
          onClick={onCreateImageNode}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-[#161618]/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md hover:border-white/25 hover:bg-[#222226] hover:text-white active:scale-95 transition-all cursor-pointer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-zinc-400 group-hover:text-white transition-colors"
          >
            <line x1="5" y1="19" x2="11" y2="5" />
            <line x1="10" y1="19" x2="16" y2="5" />
            <line x1="15" y1="19" x2="21" y2="5" />
          </svg>
          <span>图片换背景</span>
        </button>

        {/* 首帧生成视频 */}
        <button
          type="button"
          onClick={onCreateFirstFrameToVideo}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-[#161618]/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md hover:border-white/25 hover:bg-[#222226] hover:text-white active:scale-95 transition-all cursor-pointer"
        >
          <Sparkles size={14} className="text-zinc-400 group-hover:text-white transition-colors" />
          <span>首帧生成视频</span>
        </button>

        {/* 音频生视频 */}
        <button
          type="button"
          onClick={onCreateAudioToVideo}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-[#161618]/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md hover:border-white/25 hover:bg-[#222226] hover:text-white active:scale-95 transition-all cursor-pointer"
        >
          <Music2 size={14} className="text-zinc-400 group-hover:text-white transition-colors" />
          <span>音频生视频</span>
        </button>

        {/* 模板 */}
        <button
          type="button"
          onClick={onLoadTemplate}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-[#161618]/90 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl backdrop-blur-md hover:border-white/25 hover:bg-[#222226] hover:text-white active:scale-95 transition-all cursor-pointer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-zinc-400 group-hover:text-white transition-colors"
          >
            <rect x="7" y="3" width="10" height="6" rx="1.5" />
            <rect x="3" y="15" width="8" height="6" rx="1.5" />
            <rect x="13" y="15" width="8" height="6" rx="1.5" />
            <path d="M12 9v3M7 15v-3h10v3" />
          </svg>
          <span>模板</span>
        </button>
      </div>
    </motion.div>
  );
}

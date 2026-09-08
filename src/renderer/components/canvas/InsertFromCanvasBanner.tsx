import React from 'react';
import { Panel } from '@xyflow/react';
import { X, Layers } from 'lucide-react';
import { useChatStore } from '../../state/useChatStore';
import * as chatStore from '../../state/chatStore';

export interface InsertFromCanvasBannerProps {
  sessionId: string;
}

/**
 * TapNow-style "Insert from canvas" Picking Mode Banner.
 *
 * Appears at the top-center of the canvas when the user initiates
 * "Insert from canvas" from the Composer.
 * Matches screenshot 24:
 * Vivid sky-blue pill with "Insert from canvas", "Click nodes to add as reference",
 * and an "Exit" pill button.
 */
export default function InsertFromCanvasBanner({ sessionId }: InsertFromCanvasBannerProps) {
  const isPicking = useChatStore((s) => (sessionId ? s.pickingReferenceBySession[sessionId] : false)) ?? false;
  const nodeRefsCount = useChatStore((s) => (sessionId ? s.nodeRefsBySession[sessionId]?.length : 0)) ?? 0;

  if (!isPicking) return null;

  return (
    <Panel position="top-center" className="mt-4 pointer-events-none z-40">
      <div className="pointer-events-auto flex items-center gap-3.5 rounded-2xl bg-[#0284c7] px-4 py-2.5 text-white shadow-[0_12px_32px_rgba(2,132,199,0.45)] border border-sky-300/40 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-white shrink-0">
          <Layers size={17} className="text-white animate-pulse" />
        </div>
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-white">Insert from canvas</span>
            {nodeRefsCount > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-100">
                已选 {nodeRefsCount}
              </span>
            )}
          </div>
          <span className="text-[11px] text-sky-100/90 leading-tight">
            Click nodes to add as reference (点击节点加入引用)
          </span>
        </div>
        <button
          type="button"
          onClick={() => chatStore.setPickingReference(sessionId, false)}
          className="ml-2 inline-flex items-center gap-1 rounded-full bg-sky-950/40 hover:bg-sky-950/65 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm transition-all shadow-sm cursor-pointer active:scale-95"
          title="退出拾取模式 (Esc)"
        >
          <span>Exit</span>
          <X size={12} className="opacity-80" />
        </button>
      </div>
    </Panel>
  );
}

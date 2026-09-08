import React, { useMemo } from 'react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';
import { Compass, ArrowUpRight } from 'lucide-react';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';

export interface ReturnToNodesToastProps {
  sessionId: string;
}

/**
 * TapNow-style Empty Viewport Guidance Toast (Return to nodes).
 *
 * When pan/zoom leaves the bounding box of all canvas nodes,
 * displays a floating pill at the top-center of the canvas:
 * "当前视口无可见节点 · 返回节点内容"
 *
 * Clicking triggers a smooth camera flight back to all nodes.
 */
export default function ReturnToNodesToast({ sessionId }: ReturnToNodesToastProps) {
  const storeNodes = useCanvasStore((s) => s.nodesBySession[sessionId] ?? canvasStore.EMPTY_NODES);
  const { x, y, zoom } = useViewport();
  const rf = useReactFlow();

  const isOutside = useMemo(() => {
    if (storeNodes.length === 0) return false;
    // Window viewport dimensions
    const vpW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vpH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    // Viewport bounds converted to flow coordinates
    const vpLeft = -x / zoom;
    const vpTop = -y / zoom;
    const vpRight = (-x + vpW) / zoom;
    const vpBottom = (-y + vpH) / zoom;

    // Check if any node intersects the visible screen area
    const hasVisibleNode = storeNodes.some((n) => {
      const nw = n.w || 260;
      const nh = n.h || 180;
      return n.x + nw > vpLeft && n.x < vpRight && n.y + nh > vpTop && n.y < vpBottom;
    });

    return !hasVisibleNode;
  }, [storeNodes, x, y, zoom]);

  if (!isOutside || storeNodes.length === 0) {
    return null;
  }

  return (
    <Panel position="top-center" className="mt-4 pointer-events-none z-40">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-line/70 bg-[#18181b]/92 px-3.5 py-1.5 text-xs text-ink shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
        <span className="flex items-center gap-1.5 text-ink-muted">
          <Compass size={13} className="text-accent shrink-0 animate-pulse" />
          <span>当前视口无可见节点</span>
        </span>
        <button
          type="button"
          onClick={() => rf.fitView({ padding: 0.25, duration: 400 })}
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline cursor-pointer transition-colors"
          title="平滑定位回所有节点 (Return to nodes)"
        >
          <span>返回节点内容</span>
          <ArrowUpRight size={12} />
        </button>
      </div>
    </Panel>
  );
}

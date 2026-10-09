import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasNode } from '../../../shared/canvas';
import useNodeScreenAnchor from './useNodeScreenAnchor';

/** Spatially anchored in canvas screen pixels, outside the scaled node layer. */
export default function NodePanelViewport({ node, children, onClose, onBoundary }: {
  node: CanvasNode;
  children: ReactNode;
  onClose: () => void;
  onBoundary?: (element: HTMLDivElement | null) => void;
}) {
  const { canvas, nodeRect, canvasWidth, canvasHeight, railRect, navRect } = useNodeScreenAnchor(node);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(240);
  useLayoutEffect(() => { onBoundary?.(canvas); return () => onBoundary?.(null); }, [canvas, onBoundary]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => setPanelHeight((height) => Math.abs(height - panel.offsetHeight) < 1 ? height : panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [canvas]);
  if (!canvas) return null;
  let width = Math.max(0, Math.min(680, canvasWidth - 24));
  const bottom = Math.min(canvasHeight - 12, navRect ? navRect.top - 12 : canvasHeight - 12);
  const maxHeight = Math.max(0, bottom - 12);
  const height = Math.min(panelHeight, maxHeight);
  const center = nodeRect.left + nodeRect.width / 2;
  const below = nodeRect.top + nodeRect.height + 12;
  const above = nodeRect.top - height - 12;
  const preferredTop = below + height <= bottom ? below : above >= 12 ? above : below;
  const top = Math.max(12, Math.min(preferredTop, bottom - height));
  let minimumLeft = 12;
  const overlapsRail = railRect && top < railRect.top + railRect.height + 12 && top + height > railRect.top - 12;
  if (overlapsRail) {
    minimumLeft = Math.min(canvasWidth - 12, railRect.left + railRect.width + 12);
    width = Math.max(0, Math.min(width, canvasWidth - minimumLeft - 12));
  }
  const left = Math.max(minimumLeft, Math.min(center - width / 2, canvasWidth - width - 12));
  return createPortal(
    <div ref={panelRef} data-mention-composer={node.id} data-node-panel-screen role="region" aria-label={`${node.title || '节点'}输入面板`}
      className="nodrag nopan nowheel pointer-events-auto absolute z-[6] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-xl"
      style={{ width, maxHeight, left: Math.round(left), top: Math.round(top) }}
      onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); }
      }}>
      {children}
    </div>, canvas,
  );
}

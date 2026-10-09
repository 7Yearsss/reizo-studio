import { useLayoutEffect, useState } from 'react';
import { useStore } from '@xyflow/react';
import type { CanvasNode } from '../../../shared/canvas';

export interface CanvasScreenRect { left: number; top: number; width: number; height: number; }
const sameNumbers = (left: number[], right: number[]) => left.length === right.length && left.every((value, index) => value === right[index]);
const sameRect = (left: CanvasScreenRect | null, right: CanvasScreenRect | null) => left === right || Boolean(left && right && left.left === right.left && left.top === right.top && left.width === right.width && left.height === right.height);

/** Only visible node overlays use this subscription; it never changes the viewport. */
export default function useNodeScreenAnchor(node: CanvasNode) {
  const canvas = useStore((state) => state.domNode);
  const coordinates = useStore((state) => {
    const internal = state.nodeLookup.get(node.id);
    return [internal?.internals.positionAbsolute.x ?? node.x, internal?.internals.positionAbsolute.y ?? node.y,
      internal?.measured.width ?? node.w, internal?.measured.height ?? node.h,
      ...state.transform, state.width, state.height];
  }, sameNumbers);
  const [x, y, width, height, tx, ty, zoom, canvasWidth, canvasHeight] = coordinates;
  const [railRect, setRailRect] = useState<CanvasScreenRect | null>(null);
  const [navRect, setNavRect] = useState<CanvasScreenRect | null>(null);
  useLayoutEffect(() => {
    const rail = canvas?.querySelector<HTMLElement>('[role="group"][aria-label="画布工具"]');
    const navigation = canvas?.querySelector<HTMLElement>('[role="group"][aria-label="画布导航与历史"]');
    if (!canvas) { setRailRect(null); setNavRect(null); return; }
    const measure = () => {
      const boundary = canvas.getBoundingClientRect();
      const relative = (element?: HTMLElement | null) => {
        const bounds = element?.getBoundingClientRect();
        return bounds?.width && bounds.height ? { left: bounds.left - boundary.left, top: bounds.top - boundary.top, width: bounds.width, height: bounds.height } : null;
      };
      const nextRail = relative(rail); const nextNavigation = relative(navigation);
      setRailRect((previous) => sameRect(previous, nextRail) ? previous : nextRail);
      setNavRect((previous) => sameRect(previous, nextNavigation) ? previous : nextNavigation);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (rail) observer.observe(rail);
    if (navigation) observer.observe(navigation);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas, canvasWidth, canvasHeight]);
  return { canvas, canvasWidth, canvasHeight, railRect, navRect,
    nodeRect: { left: x * zoom + tx, top: y * zoom + ty, width: width * zoom, height: height * zoom } };
}

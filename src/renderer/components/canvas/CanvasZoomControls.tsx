import { useReactFlow, useStore } from '@xyflow/react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { Button } from '../ui/button';
import Tooltip from '../ui/Tooltip';
import { CanvasToolButton } from './CanvasToolbar';

/** Zoom changes repaint this small control group, not the entire canvas shell. */
export default function CanvasZoomControls() {
  const flow = useReactFlow();
  const percent = useStore((state) => Math.round((state.transform[2] || 1) * 100));
  const reducedMotion = useReducedMotion();
  const duration = reducedMotion ? 0 : 150;
  return (
    <>
      <CanvasToolButton disabled={percent <= 5} onClick={() => { void flow.zoomOut({ duration }); }} title="缩小 (Ctrl + -)"><ZoomOut /></CanvasToolButton>
      <Tooltip content="重置为 100% (Ctrl+0)" side="top">
        <Button type="button" variant="ghost" size="sm" aria-label={`当前缩放 ${percent}%，点击重置为 100%`} onClick={() => { void flow.zoomTo(1, { duration }); }} className="min-w-14 tabular-nums">{percent}%</Button>
      </Tooltip>
      <CanvasToolButton disabled={percent >= 300} onClick={() => { void flow.zoomIn({ duration }); }} title="放大 (Ctrl + +)"><ZoomIn /></CanvasToolButton>
    </>
  );
}

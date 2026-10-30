import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { agentMiniPreview } from '../../../shared/agentCursor';
import { useCanvasStore } from '../../state/useCanvasStore';
import * as canvasStore from '../../state/canvasStore';
import * as uiStore from '../../state/uiStore';

/**
 * Floats in a corner of the conversation while the agent works on a canvas that is not on screen, so the work is not
 * invisible; one click brings the canvas up. It never appears over the canvas itself and takes no focus.
 */
export default function AgentMiniPreview({ sessionId, canvasVisible }: { sessionId: string; canvasVisible: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const trail = useCanvasStore((s) => s.trailBySession[sessionId] ?? canvasStore.EMPTY_TRAIL);
  const [tick, setTick] = useState(0);
  const preview = useMemo(() => {
    void tick;
    return agentMiniPreview(trail, Date.now(), canvasVisible);
  }, [trail, canvasVisible, tick]);
  useEffect(() => {
    if (!preview) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), 1000);
    return () => clearTimeout(timer);
  }, [preview, tick]);
  return (
    <AnimatePresence>
      {preview ? (
        <motion.button
          key="mini"
          type="button"
          data-ui="canvas.mini-preview"
          onClick={() => uiStore.setRightPanelTabForSession(sessionId, 'canvas')}
          initial={reduce ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
          className="absolute right-4 top-14 z-20 flex max-w-64 items-center gap-2 rounded-full border border-line bg-paper-raised/95 px-3 py-1.5 text-xs text-ink shadow-md backdrop-blur-sm hover:bg-paper-inset"
          aria-label={`Agent ${preview.working ? '正在' : '刚刚在'}画布上操作：${preview.label}。点击打开画布`}
        >
          <span className={preview.working && !reduce ? 'size-2 shrink-0 animate-pulse rounded-full bg-accent' : 'size-2 shrink-0 rounded-full bg-accent/60'} />
          <span className="truncate">{preview.label}</span>
          <span className="shrink-0 text-ink-muted">查看画布</span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

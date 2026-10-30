import { ViewportPortal, useStore } from '@xyflow/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CursorTarget } from '../../../shared/agentCursor';

/**
 * The agent's pointer on the canvas: it glides (spring) to the node being worked on, pulses while the action runs,
 * and stays a constant on-screen size however far the canvas is zoomed. It never takes input.
 */
export default function AgentCursor({ target }: { target: CursorTarget | null }) {
  const reduce = useReducedMotion() ?? false;
  const zoom = useStore((s) => s.transform[2]);
  const scale = 1 / Math.max(0.05, zoom);
  return (
    <ViewportPortal>
      <AnimatePresence>
        {target ? (
          <motion.div
            key="agent-cursor"
            aria-hidden
            data-ui="canvas.agent-cursor"
            className="pointer-events-none absolute left-0 top-0 z-[2000]"
            initial={{ x: target.x, y: target.y, opacity: 0 }}
            animate={{ x: target.x, y: target.y, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 22, opacity: { duration: 0.2 } }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
              <svg width="20" height="22" viewBox="0 0 20 22" className="drop-shadow">
                <path d="M2 1.5 L2 17 L6.2 13.2 L9 19.8 L11.6 18.7 L8.9 12.3 L14.5 12.3 Z" fill="var(--accent, #6366f1)" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              {target.working && !reduce ? <span className="absolute left-0 top-0 -ml-2 -mt-2 size-5 animate-ping rounded-full bg-accent/40" /> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ViewportPortal>
  );
}

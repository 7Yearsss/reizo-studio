import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { getSourceHandleColor, getTargetHandleColor } from './edgeStyles';

export interface CuttableEdgeData extends Record<string, unknown> {
  sourceType?: string;
  targetType?: string;
  isRunning?: boolean;
  onCutEdge?: (edgeId: string) => void;
}

export default function CuttableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  data,
}: EdgeProps) {
  const edgeData = (data as CuttableEdgeData) || {};
  const { sourceType, targetType, isRunning, onCutEdge } = edgeData;

  const [visible, setVisible] = useState(false);
  const [dying, setDying] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [pathLength, setPathLength] = useState(0);

  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const srcColor = getSourceHandleColor(sourceType, sourceHandleId);
  const tgtColor = getTargetHandleColor(targetType, targetHandleId);

  const gradId = `reizo-edge-grad-${id}`;
  const useGradient = srcColor !== tgtColor;
  const strokeValue = isRunning ? 'var(--accent, #6366f1)' : useGradient ? `url(#${gradId})` : tgtColor;
  const badgeColor = isRunning ? 'var(--accent, #6366f1)' : tgtColor;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  useEffect(() => {
    if (pathRef.current) {
      try {
        setPathLength(pathRef.current.getTotalLength());
      } catch {
        /* ignore measuring errors in detached states */
      }
    }
  }, [edgePath]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dying) return;
      if (leaveTimer.current) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      const cursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const el = pathRef.current;
      if (el) {
        try {
          const total = el.getTotalLength();
          if (total > 0) {
            let lo = 0;
            let hi = total;
            let best = el.getPointAtLength(0);
            let bestDist = Infinity;
            const STEPS = 24;
            for (let i = 0; i <= STEPS; i++) {
              const pt = el.getPointAtLength((i / STEPS) * total);
              const d = Math.hypot(pt.x - cursor.x, pt.y - cursor.y);
              if (d < bestDist) {
                bestDist = d;
                best = pt;
                lo = Math.max(0, ((i - 1) / STEPS) * total);
                hi = Math.min(total, ((i + 1) / STEPS) * total);
              }
            }
            // 3 rounds of binary refinement
            for (let i = 0; i < 3; i++) {
              const mid = (lo + hi) / 2;
              const ptLo = el.getPointAtLength(mid - (hi - lo) / 4);
              const ptHi = el.getPointAtLength(mid + (hi - lo) / 4);
              const dLo = Math.hypot(ptLo.x - cursor.x, ptLo.y - cursor.y);
              const dHi = Math.hypot(ptHi.x - cursor.x, ptHi.y - cursor.y);
              if (dLo < dHi) {
                hi = mid;
                best = ptLo;
              } else {
                lo = mid;
                best = ptHi;
              }
            }
            setPos({ x: best.x, y: best.y });
            setVisible(true);
            return;
          }
        } catch {
          /* fallback to cursor position */
        }
      }
      setPos(cursor);
      setVisible(true);
    },
    [screenToFlowPosition, dying],
  );

  const handleMouseLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setVisible(false), 120);
  }, []);

  const handleBadgeEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const handleCut = useCallback(() => {
    if (dying) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      onCutEdge?.(id);
      return;
    }

    setDying(true);
    setTimeout(() => {
      onCutEdge?.(id);
    }, 360);
  }, [dying, id, onCutEdge]);

  return (
    <>
      {useGradient && (
        <defs>
          <linearGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={srcColor} />
            <stop offset="100%" stopColor={tgtColor} />
          </linearGradient>
        </defs>
      )}

      {/* Hidden path for measuring length */}
      <path ref={pathRef} d={edgePath} fill="none" stroke="transparent" />

      {/* Visible edge line */}
      <path
        d={edgePath}
        fill="none"
        stroke={strokeValue}
        strokeWidth={isRunning ? 2.5 : 1.8}
        strokeLinecap="round"
        strokeDasharray={dying && pathLength > 0 ? `${pathLength} ${pathLength}` : isRunning ? '5' : undefined}
        strokeDashoffset={dying && pathLength > 0 ? pathLength : undefined}
        className={isRunning && !dying ? 'animate-[dashdraw_0.5s_linear_infinite]' : undefined}
        style={{
          pointerEvents: 'none',
          transition: dying ? 'stroke-dashoffset 350ms ease-in' : 'stroke 200ms ease',
        }}
      />

      {/* Wide transparent hit area on top */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'pointer', pointerEvents: dying ? 'none' : 'stroke' }}
      />

      {/* Scissor badge in EdgeLabelRenderer */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
            pointerEvents: visible && !dying ? 'all' : 'none',
            zIndex: 1000,
            opacity: visible && !dying ? 1 : 0,
            transition: 'opacity 150ms ease',
          }}
          onMouseEnter={handleBadgeEnter}
          onMouseLeave={handleMouseLeave}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCut();
            }}
            title="剪断连线"
            className="flex h-7 w-7 items-center justify-center rounded-full border bg-paper-raised text-ink shadow-md transition-all duration-150 hover:scale-110 active:scale-95"
            style={{
              borderColor: badgeColor,
              boxShadow: `0 2px 10px rgba(0,0,0,0.25), 0 0 8px ${badgeColor}33`,
            }}
          >
            <Scissors size={13} style={{ color: badgeColor }} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

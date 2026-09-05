import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { getSourceHandleColor, getTargetHandleColor } from './edgeStyles';

export interface CuttableEdgeData extends Record<string, unknown> {
  sourceType?: string;
  targetType?: string;
  isRunning?: boolean;
  onCutEdge?: (edgeId: string) => void;
  onRerouteEdge?: (edgeId: string, screenPos: { x: number; y: number }) => void;
}

/** Only one edge is "armed" (dashed, showing scissors) at a time. */
const ARMED_EVENT = 'reizo:edge-armed';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * An edge that transmits a slow "energy" flow toward its target (faster while
 * the target runs) and is cut in two steps — click the line to arm it (it goes
 * dashed and shows scissors), click the scissors to cut. Hover never shows the
 * scissors, so a stray mouse-over can't delete a wire.
 */
function CuttableEdge({
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
  const { sourceType, targetType, isRunning, onCutEdge, onRerouteEdge } = (data as CuttableEdgeData) || {};

  const [armed, setArmed] = useState(false);
  const [dying, setDying] = useState(false);
  const [pathLength, setPathLength] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const srcColor = getSourceHandleColor(sourceType, sourceHandleId);
  const tgtColor = getTargetHandleColor(targetType, targetHandleId);
  const gradId = `reizo-edge-grad-${id}`;
  const useGradient = srcColor !== tgtColor;
  const baseStroke = isRunning ? 'var(--accent, #6366f1)' : useGradient ? `url(#${gradId})` : tgtColor;
  const flowStroke = isRunning ? 'var(--accent, #6366f1)' : tgtColor;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Disarm when another edge arms (only listen when this edge is currently armed).
  useEffect(() => {
    if (!armed) return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setArmed(false);
    };
    window.addEventListener(ARMED_EVENT, onOther);
    return () => window.removeEventListener(ARMED_EVENT, onOther);
  }, [armed, id]);

  // While armed: Esc or an outside click disarms.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmed(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!badgeRef.current?.contains(e.target as Node)) setArmed(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [armed]);

  const arm = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (dying) return;
      setArmed(true);
      window.dispatchEvent(new CustomEvent(ARMED_EVENT, { detail: id }));
    },
    [dying, id],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRerouteEdge?.(id, { x: e.clientX, y: e.clientY });
    },
    [id, onRerouteEdge],
  );

  const cut = useCallback(() => {
    if (dying) return;
    if (prefersReducedMotion()) {
      onCutEdge?.(id);
      return;
    }
    if (pathRef.current) {
      try {
        setPathLength(pathRef.current.getTotalLength());
      } catch {
        /* detached — ignore */
      }
    }
    setDying(true);
    setTimeout(() => onCutEdge?.(id), 360);
  }, [dying, id, onCutEdge]);

  const reduced = prefersReducedMotion();

  return (
    <>
      {useGradient && (
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
            <stop offset="0%" stopColor={srcColor} />
            <stop offset="100%" stopColor={tgtColor} />
          </linearGradient>
        </defs>
      )}

      {/* base line (also measures path for cut animation) */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke={baseStroke}
        strokeWidth={armed || isRunning ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeDasharray={
          dying && pathLength > 0 ? `${pathLength} ${pathLength}` : armed ? '6 4' : undefined
        }
        strokeDashoffset={dying && pathLength > 0 ? pathLength : undefined}
        style={{
          pointerEvents: 'none',
          opacity: armed ? 0.9 : 0.8,
          transition: dying ? 'stroke-dashoffset 350ms ease-in' : 'stroke-width 150ms ease, opacity 150ms ease',
        }}
      />

      {/* energy flow overlay — only active when running to avoid ambient noise */}
      {!dying && !armed && !reduced && isRunning && (
        <path
          d={edgePath}
          fill="none"
          stroke={flowStroke}
          strokeWidth={2.4}
          strokeLinecap="round"
          className="edge-flow edge-flow-running"
          style={{ pointerEvents: 'none', opacity: 0.9 }}
        />
      )}

      {/* wide transparent hit area — click to arm, double click to reroute */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onClick={arm}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: 'pointer', pointerEvents: dying ? 'none' : 'stroke' }}
      />

      {armed && !dying ? (
        <EdgeLabelRenderer>
          <div
            ref={badgeRef}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cut();
              }}
              title="剪断连线"
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-paper-raised text-ink shadow-md transition-transform duration-150 hover:scale-110 active:scale-95"
              style={{ borderColor: flowStroke, boxShadow: `0 2px 10px rgba(0,0,0,0.25), 0 0 8px ${flowStroke}33` }}
            >
              <Scissors size={13} style={{ color: flowStroke }} />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export default React.memo(CuttableEdge);

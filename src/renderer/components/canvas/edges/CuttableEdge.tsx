import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { getSourceHandleColor, getTargetHandleColor } from './edgeStyles';

export interface CuttableEdgeData extends Record<string, unknown> {
  sourceType?: string;
  targetType?: string;
  isRunning?: boolean;
  onCutEdge?: (edgeId: string) => void;
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
  const { sourceType, targetType, isRunning, onCutEdge } = (data as CuttableEdgeData) || {};

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

  useEffect(() => {
    if (!pathRef.current) return;
    try {
      setPathLength(pathRef.current.getTotalLength());
    } catch {
      /* detached — ignore */
    }
  }, [edgePath]);

  // Disarm when another edge arms.
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setArmed(false);
    };
    window.addEventListener(ARMED_EVENT, onOther);
    return () => window.removeEventListener(ARMED_EVENT, onOther);
  }, [id]);

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

  const cut = useCallback(() => {
    if (dying) return;
    if (prefersReducedMotion()) {
      onCutEdge?.(id);
      return;
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

      {/* measure path */}
      <path ref={pathRef} d={edgePath} fill="none" stroke="transparent" />

      {/* base line */}
      <path
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

      {/* energy flow overlay */}
      {!dying && !armed && !reduced && (
        <path
          d={edgePath}
          fill="none"
          stroke={flowStroke}
          strokeWidth={isRunning ? 2.4 : 1.6}
          strokeLinecap="round"
          className={isRunning ? 'edge-flow edge-flow-running' : 'edge-flow'}
          style={{ pointerEvents: 'none', opacity: isRunning ? 0.9 : 0.4 }}
        />
      )}

      {/* wide transparent hit area — click to arm */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onClick={arm}
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

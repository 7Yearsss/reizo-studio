import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import Tooltip from '../../ui/Tooltip';
import { getSourceHandleColor, getTargetHandleColor } from './edgeStyles';

export interface CuttableEdgeData extends Record<string, unknown> {
  sourceType?: string;
  targetType?: string;
  isRunning?: boolean;
  isRevealed?: boolean;
  onCutEdge?: (edgeId: string) => void;
  onRerouteEdge?: (edgeId: string, screenPos: { x: number; y: number }) => void;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ARMED_EVENT = 'reizo:edge-armed';

function clientToPathSpace(path: SVGPathElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = path.ownerSVGElement;
  const ctm = path.getScreenCTM();
  if (!svg || !ctm) return null;
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  } catch {
    return null;
  }
}

function closestPointOnPath(path: SVGPathElement, x: number, y: number): { x: number; y: number } {
  const len = path.getTotalLength();
  if (!Number.isFinite(len) || len <= 0) return { x, y };
  const steps = Math.max(24, Math.min(80, Math.floor(len / 8)));
  let bestX = x;
  let bestY = y;
  let bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const p = path.getPointAtLength((i / steps) * len);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestX = p.x;
      bestY = p.y;
    }
  }
  return { x: bestX, y: bestY };
}

/**
 * Click the wire: dashed + scissors park on the curve at the click.
 * While the pointer stays on THAT wire, scissors slide along it.
 * Leave the wire and they stay put — they never chase the cursor around the canvas.
 * Click the badge to cut. Hover never deletes.
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
  const { sourceType, targetType, isRunning, isRevealed = true, onCutEdge, onRerouteEdge } = (data as CuttableEdgeData) || {};

  const [armed, setArmed] = useState(false);
  const [badge, setBadge] = useState<{ x: number; y: number } | null>(null);
  const [dying, setDying] = useState(false);
  const [pathLength, setPathLength] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);
  const hitRef = useRef<SVGPathElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const srcColor = getSourceHandleColor(sourceType, sourceHandleId);
  const tgtColor = getTargetHandleColor(targetType, targetHandleId);
  const gradId = `reizo-edge-grad-${id}`;
  const useGradient = srcColor !== tgtColor;
  const baseStroke = isRunning ? 'var(--accent, #6366f1)' : useGradient ? `url(#${gradId})` : tgtColor;
  const flowStroke = isRunning ? 'var(--accent, #6366f1)' : tgtColor;
  const active = armed && !dying;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const parkAtPointer = useCallback((clientX: number, clientY: number) => {
    const path = pathRef.current;
    if (!path) return;
    const loc = clientToPathSpace(path, clientX, clientY);
    if (!loc) return;
    setBadge(closestPointOnPath(path, loc.x, loc.y));
  }, []);

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

  const armAtPointer = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (dying || !isRevealed) return;
      setArmed(true);
      parkAtPointer(e.clientX, e.clientY);
      window.dispatchEvent(new CustomEvent(ARMED_EVENT, { detail: id }));
    },
    [dying, id, isRevealed, parkAtPointer],
  );

  const followOnLine = useCallback(
    (e: React.MouseEvent) => {
      if (!armed || dying || !isRevealed) return;
      parkAtPointer(e.clientX, e.clientY);
    },
    [armed, dying, isRevealed, parkAtPointer],
  );

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmed(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (badgeRef.current?.contains(e.target as Node)) return;
      if (hitRef.current && e.target === hitRef.current) return;
      setArmed(false);
    };
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setArmed(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener(ARMED_EVENT, onOther);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener(ARMED_EVENT, onOther);
    };
  }, [armed, id]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isRevealed) return;
      onRerouteEdge?.(id, { x: e.clientX, y: e.clientY });
    },
    [id, isRevealed, onRerouteEdge],
  );

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
        strokeWidth={active || isRunning ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeDasharray={dying && pathLength > 0 ? `${pathLength} ${pathLength}` : active ? '6 4' : undefined}
        strokeDashoffset={dying && pathLength > 0 ? pathLength : undefined}
        style={{
          pointerEvents: 'none',
          opacity: !isRevealed ? 0 : active ? 0.95 : 0.8,
          transition: dying ? 'stroke-dashoffset 350ms ease-in' : 'stroke-width 150ms ease, opacity 200ms ease',
        }}
      />

      {/* energy flow overlay — only active when running to avoid ambient noise */}
      {!dying && !active && !reduced && isRunning && isRevealed && (
        <path
          d={edgePath}
          fill="none"
          stroke={flowStroke}
          strokeWidth={2.4}
          strokeLinecap="round"
          className="edge-flow edge-flow-running"
          style={{ pointerEvents: 'none', opacity: 0.9, transition: 'opacity 200ms ease' }}
        />
      )}

      {/* wide hit area — click to arm; mousemove only follows while on this wire */}
      <path
        ref={hitRef}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        onClick={armAtPointer}
        onMouseMove={followOnLine}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isRevealed ? 'pointer' : 'default', pointerEvents: dying || !isRevealed ? 'none' : 'stroke' }}
      />

      {active && badge && isRevealed ? (
        <EdgeLabelRenderer>
          <div
            ref={badgeRef}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${badge.x}px, ${badge.y}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
            }}
          >
            <Tooltip content="剪断连线" side="top" wrapperClassName="inline-flex">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cut();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full border bg-paper-raised text-ink shadow-md transition-transform duration-150 hover:scale-110 active:scale-95"
                style={{ borderColor: flowStroke, boxShadow: `0 2px 10px rgba(0,0,0,0.25), 0 0 8px ${flowStroke}33` }}
              >
                <Scissors size={13} style={{ color: flowStroke }} />
              </button>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export default React.memo(CuttableEdge);

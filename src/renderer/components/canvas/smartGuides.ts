export interface NodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
}

export interface GuideLine {
  /** 'horizontal' means line is parallel to X-axis (y = const), indicating vertical alignment */
  /** 'vertical' means line is parallel to Y-axis (x = const), indicating horizontal alignment */
  type: 'horizontal' | 'vertical';
  /** The coordinate on the axis (y for horizontal, x for vertical) */
  pos: number;
  /** Start and end points along the perpendicular axis */
  start: number;
  end: number;
  /** Alignment type: 'center' | 'edge' */
  alignment: 'center' | 'edge';
  /** Center anchor beads to render on the line */
  centerPoints?: { x: number; y: number }[];
}

export interface SmartGuidesResult {
  snappedPosition: { x: number; y: number };
  horizontal: GuideLine | null;
  vertical: GuideLine | null;
}

export interface SmartGuidesOptions {
  /** Snap distance in screen pixels (defaults to 8px) */
  thresholdPx?: number;
  /** Center alignment priority multiplier (defaults to 0.8 for subtle preferential bias) */
  centerBias?: number;
}

/**
 * Calculates alignment guide lines and snapped position for a dragged node.
 * Pure functional calculation with zero side effects.
 */
export function calculateSmartGuides(
  dragged: NodeRect,
  others: NodeRect[],
  zoom = 1,
  options: SmartGuidesOptions = {},
): SmartGuidesResult {
  const thresholdPx = options.thresholdPx ?? 8;
  const centerBias = options.centerBias ?? 0.8;

  // Convert screen pixel threshold to canvas coordinate units, safe-clamped
  const safeZoom = Math.max(0.01, zoom);
  const threshold = Math.min(24, Math.max(4, thresholdPx / safeZoom));

  // Exclude section nodes and self
  const targetNodes = others.filter(
    (n) => n.id !== dragged.id && n.type !== 'section',
  );

  let snappedX = dragged.x;
  let snappedY = dragged.y;
  let verticalGuide: GuideLine | null = null;
  let horizontalGuide: GuideLine | null = null;

  if (targetNodes.length === 0) {
    return {
      snappedPosition: { x: snappedX, y: snappedY },
      horizontal: null,
      vertical: null,
    };
  }

  // ==========================================
  // 1. X-Axis Snapping (Produces Vertical Line)
  // ==========================================
  const draggedCenterX = dragged.x + dragged.width / 2;
  const draggedLeft = dragged.x;
  const draggedRight = dragged.x + dragged.width;

  interface XCandidate {
    snappedX: number;
    lineX: number;
    distance: number;
    effectiveDistance: number;
    alignment: 'center' | 'edge';
    targetNode: NodeRect;
  }

  const xCandidates: XCandidate[] = [];

  for (const t of targetNodes) {
    const targetCenterX = t.x + t.width / 2;
    const targetLeft = t.x;
    const targetRight = t.x + t.width;

    // A. Center to Center (Top Priority: 中间齐平线)
    const distCenter = Math.abs(draggedCenterX - targetCenterX);
    if (distCenter <= threshold) {
      xCandidates.push({
        snappedX: targetCenterX - dragged.width / 2,
        lineX: targetCenterX,
        distance: distCenter,
        effectiveDistance: distCenter * centerBias,
        alignment: 'center',
        targetNode: t,
      });
    }

    // B. Left to Left
    const distLeft = Math.abs(draggedLeft - targetLeft);
    if (distLeft <= threshold) {
      xCandidates.push({
        snappedX: targetLeft,
        lineX: targetLeft,
        distance: distLeft,
        effectiveDistance: distLeft,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // C. Right to Right
    const distRight = Math.abs(draggedRight - targetRight);
    if (distRight <= threshold) {
      xCandidates.push({
        snappedX: targetRight - dragged.width,
        lineX: targetRight,
        distance: distRight,
        effectiveDistance: distRight,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // D. Left to Right (Side-by-side adjacent)
    const distLeftRight = Math.abs(draggedLeft - targetRight);
    if (distLeftRight <= threshold) {
      xCandidates.push({
        snappedX: targetRight,
        lineX: targetRight,
        distance: distLeftRight,
        effectiveDistance: distLeftRight,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // E. Right to Left (Side-by-side adjacent)
    const distRightLeft = Math.abs(draggedRight - targetLeft);
    if (distRightLeft <= threshold) {
      xCandidates.push({
        snappedX: targetLeft - dragged.width,
        lineX: targetLeft,
        distance: distRightLeft,
        effectiveDistance: distRightLeft,
        alignment: 'edge',
        targetNode: t,
      });
    }
  }

  if (xCandidates.length > 0) {
    // Pick the candidate with smallest effective distance
    xCandidates.sort((a, b) => a.effectiveDistance - b.effectiveDistance);
    const bestX = xCandidates[0];
    snappedX = bestX.snappedX;

    // Find all target nodes aligned to this exact vertical line
    const alignedTargets = targetNodes.filter((t) => {
      if (bestX.alignment === 'center') {
        return Math.abs(t.x + t.width / 2 - bestX.lineX) < 1;
      }
      return (
        Math.abs(t.x - bestX.lineX) < 1 ||
        Math.abs(t.x + t.width - bestX.lineX) < 1
      );
    });

    const activeNodes = [
      { y: dragged.y, height: dragged.height, x: snappedX, width: dragged.width },
      ...alignedTargets,
    ];

    const minY = Math.min(...activeNodes.map((n) => n.y)) - 24;
    const maxY = Math.max(...activeNodes.map((n) => n.y + n.height)) + 24;

    const centerPoints =
      bestX.alignment === 'center'
        ? activeNodes.map((n) => ({
            x: bestX.lineX,
            y: n.y + n.height / 2,
          }))
        : undefined;

    verticalGuide = {
      type: 'vertical',
      pos: bestX.lineX,
      start: minY,
      end: maxY,
      alignment: bestX.alignment,
      centerPoints,
    };
  }

  // ==========================================
  // 2. Y-Axis Snapping (Produces Horizontal Line)
  // ==========================================
  const draggedCenterY = dragged.y + dragged.height / 2;
  const draggedTop = dragged.y;
  const draggedBottom = dragged.y + dragged.height;

  interface YCandidate {
    snappedY: number;
    lineY: number;
    distance: number;
    effectiveDistance: number;
    alignment: 'center' | 'edge';
    targetNode: NodeRect;
  }

  const yCandidates: YCandidate[] = [];

  for (const t of targetNodes) {
    const targetCenterY = t.y + t.height / 2;
    const targetTop = t.y;
    const targetBottom = t.y + t.height;

    // A. Center to Center (Top Priority: 中间齐平线)
    const distCenter = Math.abs(draggedCenterY - targetCenterY);
    if (distCenter <= threshold) {
      yCandidates.push({
        snappedY: targetCenterY - dragged.height / 2,
        lineY: targetCenterY,
        distance: distCenter,
        effectiveDistance: distCenter * centerBias,
        alignment: 'center',
        targetNode: t,
      });
    }

    // B. Top to Top
    const distTop = Math.abs(draggedTop - targetTop);
    if (distTop <= threshold) {
      yCandidates.push({
        snappedY: targetTop,
        lineY: targetTop,
        distance: distTop,
        effectiveDistance: distTop,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // C. Bottom to Bottom
    const distBottom = Math.abs(draggedBottom - targetBottom);
    if (distBottom <= threshold) {
      yCandidates.push({
        snappedY: targetBottom - dragged.height,
        lineY: targetBottom,
        distance: distBottom,
        effectiveDistance: distBottom,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // D. Top to Bottom (Stacked adjacent)
    const distTopBottom = Math.abs(draggedTop - targetBottom);
    if (distTopBottom <= threshold) {
      yCandidates.push({
        snappedY: targetBottom,
        lineY: targetBottom,
        distance: distTopBottom,
        effectiveDistance: distTopBottom,
        alignment: 'edge',
        targetNode: t,
      });
    }

    // E. Bottom to Top (Stacked adjacent)
    const distBottomTop = Math.abs(draggedBottom - targetTop);
    if (distBottomTop <= threshold) {
      yCandidates.push({
        snappedY: targetTop - dragged.height,
        lineY: targetTop,
        distance: distBottomTop,
        effectiveDistance: distBottomTop,
        alignment: 'edge',
        targetNode: t,
      });
    }
  }

  if (yCandidates.length > 0) {
    yCandidates.sort((a, b) => a.effectiveDistance - b.effectiveDistance);
    const bestY = yCandidates[0];
    snappedY = bestY.snappedY;

    const alignedTargets = targetNodes.filter((t) => {
      if (bestY.alignment === 'center') {
        return Math.abs(t.y + t.height / 2 - bestY.lineY) < 1;
      }
      return (
        Math.abs(t.y - bestY.lineY) < 1 ||
        Math.abs(t.y + t.height - bestY.lineY) < 1
      );
    });

    const activeNodes = [
      { x: snappedX, width: dragged.width, y: snappedY, height: dragged.height },
      ...alignedTargets,
    ];

    const minX = Math.min(...activeNodes.map((n) => n.x)) - 24;
    const maxX = Math.max(...activeNodes.map((n) => n.x + n.width)) + 24;

    const centerPoints =
      bestY.alignment === 'center'
        ? activeNodes.map((n) => ({
            x: n.x + n.width / 2,
            y: bestY.lineY,
          }))
        : undefined;

    horizontalGuide = {
      type: 'horizontal',
      pos: bestY.lineY,
      start: minX,
      end: maxX,
      alignment: bestY.alignment,
      centerPoints,
    };
  }

  return {
    snappedPosition: { x: snappedX, y: snappedY },
    horizontal: horizontalGuide,
    vertical: verticalGuide,
  };
}

"use client";

import { useMemo, useRef } from "react";
import { isHoveringPointer } from "@/renderer/lib/touch";

interface BoundaryEvent {
  pointerId: number;
  pointerType: string;
  buttons: number;
}

export interface HoverGesture {
  /** True when this enter starts a hover: the pointer arrived resting, not pressing. */
  enter: (event: BoundaryEvent) => boolean;
  /** True when this leave ends a hover that entered as one. */
  leave: (event: BoundaryEvent) => boolean;
}

/**
 * Pairs a surface's enter with its leave, per pointer.
 */
export function useHoverGesture(): HoverGesture {
  const contact = useRef(new Set<number>());

  return useMemo(
    () => ({
      enter: (event) => {
        if (isHoveringPointer(event)) {
          contact.current.delete(event.pointerId);
          return true;
        }
        contact.current.add(event.pointerId);
        return false;
      },
      leave: (event) => {
        const arrivedInContact = contact.current.delete(event.pointerId);
        return !arrivedInContact && event.pointerType !== "touch";
      },
    }),
    [],
  );
}

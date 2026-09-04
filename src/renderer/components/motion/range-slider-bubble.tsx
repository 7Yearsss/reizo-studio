"use client";
// beui.dev/components/motion/range-slider

import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { useEffect } from "react";

import { SPRING_GLIDE, SPRING_PANEL, SPRING_PRESS } from "@/renderer/lib/ease";
import { type SliderOptions, useSlider } from "@/renderer/lib/hooks/use-slider";
import { TOUCH_GESTURE_CLASS } from "@/renderer/lib/touch";
import { cn } from "@/renderer/lib/cn";

// Loose enough that the bubble keeps leaning a beat after the pointer stops.
const SPRING_TILT = { stiffness: 260, damping: 22, mass: 0.4 } as const;
/** Drag speed (px/s of track percent) that maxes out lean and squash. */
const FULL_TILT = 320;

export interface BubbleSliderProps extends SliderOptions {
  /** Formats the value shown in the bubble. */
  format?: (value: number) => string;
  className?: string;
  compact?: boolean;
  bipolar?: boolean;
  onDoubleClick?: () => void;
}

/**
 * Slider with a value bubble that pops out of the thumb on grab and reacts to
 * how fast you drag: it leans into the direction of travel and squashes along
 * the way, then settles upright when you let go.
 */
export function BubbleSlider({
  format,
  className,
  compact = false,
  bipolar = false,
  onDoubleClick,
  ...options
}: BubbleSliderProps) {
  const reduce = useReducedMotion();
  // A bare number needs no valueText — it would only repeat aria-valuenow.
  const { percent, current, dragging, trackProps, sliderProps } = useSlider({
    ...options,
    formatValueText: options.formatValueText ?? format,
  });
  // The value is already snapped to the step — rounding here would only make
  // the bubble disagree with aria-valuenow on a fractional scale.
  const readout = format ? format(current) : current;

  const target = useMotionValue(percent);
  useEffect(() => {
    target.set(percent);
  }, [percent, target]);
  const smooth = useSpring(target, SPRING_GLIDE);
  const pos = reduce ? target : smooth;
  const left = useMotionTemplate`${pos}%`;

  const bipolarTrackLeft = useTransform(pos, (p) => (p < 50 ? `${p}%` : "50%"));
  const bipolarTrackWidth = useTransform(pos, (p) => `${Math.abs(p - 50)}%`);

  // One spring drives the whole reaction: lean is signed, squash reads its
  // magnitude. Two springs off the same velocity would just run twice.
  const velocity = useVelocity(pos);
  const lean = useSpring(
    useTransform(velocity, [-FULL_TILT, 0, FULL_TILT], [1, 0, -1], { clamp: true }),
    SPRING_TILT,
  );
  const tilt = useTransform(lean, (v) => v * 16);
  const squash = useTransform(lean, (v) => 1 + Math.abs(v) * 0.18);
  const stretch = useTransform(lean, (v) => 1 - Math.abs(v) * 0.12);

  return (
    <div
      onDoubleClick={onDoubleClick}
      className={cn(
        compact
          ? "relative flex h-7 w-full items-end px-2 pb-1"
          : "relative flex h-20 w-full items-end px-5 pb-5",
        options.disabled ? "pointer-events-none opacity-50" : undefined,
        className,
      )}
    >
      <div
        {...trackProps}
        className={cn(
          compact ? "h-1.5" : "h-2",
          "relative w-full touch-none rounded-full bg-paper-inset",
          TOUCH_GESTURE_CLASS,
          options.disabled ? undefined : "cursor-grab active:cursor-grabbing",
        )}
      >
        {bipolar ? (
          <>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-2 rounded-full bg-ink-muted/30" />
            <motion.div
              className="absolute inset-y-0 rounded-full bg-accent"
              style={{ left: bipolarTrackLeft, width: bipolarTrackWidth }}
            />
          </>
        ) : (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: left }}
          />
        )}

        {/* thumb — overhangs the track by half its width at both ends */}
        <motion.div
          className={cn(
            compact ? "size-3.5 border" : "size-5 border-2",
            "absolute top-1/2 rounded-full border-paper bg-ink shadow-sm",
          )}
          style={{ left, x: "-50%", y: "-50%" }}
          animate={reduce ? undefined : { scale: dragging ? (compact ? 1.3 : 1.25) : 1 }}
          transition={SPRING_PRESS}
        />

        {/* bubble — anchored to the thumb, leaning with drag velocity */}
        <motion.div
          className={cn(
            "pointer-events-none absolute",
            compact ? "bottom-4.5" : "bottom-6",
          )}
          style={{ left, x: "-50%" }}
        >
          <AnimatePresence>
            {dragging ? (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 10 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={
                  reduce
                    ? { opacity: 0, transition: { duration: 0.12 } }
                    : { opacity: 0, scale: 0.5, y: 8, transition: { duration: 0.12 } }
                }
                transition={reduce ? { duration: 0.12 } : SPRING_PANEL}
                style={
                  reduce
                    ? undefined
                    : { rotate: tilt, scaleX: squash, scaleY: stretch, originY: 1 }
                }
                className={cn(
                  "relative font-medium tabular-nums shadow-md",
                  compact
                    ? "rounded-lg bg-ink px-2 py-0.5 text-xs text-paper"
                    : "rounded-xl bg-ink px-2.5 py-1 text-sm text-paper",
                )}
              >
                {readout}
                <span
                  className={cn(
                    "absolute -bottom-1 left-1/2 -translate-x-1/2 rotate-45 rounded-[2px] bg-ink",
                    compact ? "size-2" : "size-2.5",
                  )}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>

        {/* touch / keyboard hit area */}
        <button
          type="button"
          {...sliderProps}
          className={cn(
            "absolute inset-x-0 touch-none rounded-full outline-none ring-accent/30 focus-visible:ring-2",
            compact ? "-inset-y-3" : "-inset-y-5",
          )}
        />
      </div>
    </div>
  );
}

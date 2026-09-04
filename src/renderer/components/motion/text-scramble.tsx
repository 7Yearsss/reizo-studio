"use client";

import { useReducedMotion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/renderer/lib/cn";

const DEFAULT_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$?/";

export interface TextScrambleProps {
  /** Final text revealed by the scramble animation. */
  text: string;
  /** Maximum animation duration in milliseconds. */
  duration?: number;
  /** Characters sampled while unresolved positions are scrambling. */
  glyphs?: string;
  className?: string;
  style?: CSSProperties;
  /** Whether to animate on initial mount. */
  triggerOnMount?: boolean;
  /** Callback fired when scramble finishes. */
  onSettled?: () => void;
}

/** Character scramble that resolves to `text` and respects reduced motion. */
export function TextScramble({
  text,
  duration,
  glyphs = DEFAULT_GLYPHS,
  className,
  style,
  triggerOnMount = false,
  onSettled,
}: TextScrambleProps) {
  const reduce = useReducedMotion() ?? false;
  const [display, setDisplay] = useState(text);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const settledCalled = useRef(false);

  useEffect(() => {
    if (!triggerOnMount) {
      setDisplay(text);
      if (!settledCalled.current) {
        settledCalled.current = true;
        onSettledRef.current?.();
      }
      return;
    }

    if (reduce || !glyphs) {
      setDisplay(text);
      if (!settledCalled.current) {
        settledCalled.current = true;
        onSettledRef.current?.();
      }
      return;
    }

    settledCalled.current = false;

    const characters = text.split("");
    const startedAt = performance.now();
    const animationDuration = duration
      ?? Math.min(760, Math.max(420, characters.length * 32));
    let frame = 0;
    let lastUpdate = 0;

    const animate = (now: number) => {
      if (now - lastUpdate >= 40) {
        lastUpdate = now;
        const progress = Math.min((now - startedAt) / animationDuration, 1);
        const settled = Math.floor(progress * characters.length);
        setDisplay(characters.map((character, index) => {
          if (index < settled || character === " ") return character;
          return glyphs[Math.floor(Math.random() * glyphs.length)];
        }).join(""));
      }

      if (now - startedAt < animationDuration) {
        frame = requestAnimationFrame(animate);
      } else {
        setDisplay(text);
        if (!settledCalled.current) {
          settledCalled.current = true;
          onSettledRef.current?.();
        }
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [duration, glyphs, reduce, text, triggerOnMount]);

  return (
    <span className={cn("inline-block whitespace-pre", className)} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{reduce ? text : display}</span>
    </span>
  );
}

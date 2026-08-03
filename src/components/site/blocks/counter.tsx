"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";

import { useReducedMotion } from "./use-reduced-motion";

/**
 * A number that counts up — react-bits `Counter`, adapted.
 *
 * THE ORIGINAL ANIMATES DIGIT PLACES AS SLIDING COLUMNS: one `MotionValue` per
 * decimal place, each a vertical strip of 0–9 translated into position. It looks
 * excellent and it is the wrong mechanism for this block, for two reasons that
 * only show up in our context:
 *
 * 1. It needs a fixed pixel `fontSize` to compute strip offsets, and a bento
 *    cell has no fixed size. The number has to scale with its pane.
 * 2. It renders a 10-digit strip per place inside `overflow: hidden`. A screen
 *    reader walking that markup reads the whole strip; the value is not in the
 *    document as a number anywhere.
 *
 * So this keeps the spring and drops the strips: one text node, updated from a
 * spring, with the true value in the server HTML underneath. The animation is a
 * progressive enhancement over a correct static number rather than a
 * replacement for one.
 *
 * `useInView` with `once` is kept from the original — a stat that has already
 * scrolled past should not re-run when it comes back.
 */
export function Counter({
  value,
  suffix,
  className = "",
}: {
  value: number;
  suffix?: string | null;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });

  const raw = useMotionValue(0);
  const spring = useSpring(raw, { stiffness: 90, damping: 20, mass: 0.8 });

  useEffect(() => {
    if (reduced || !inView) return;
    raw.set(value);
  }, [reduced, inView, raw, value]);

  useEffect(() => {
    if (reduced) return;

    // Take over the server-rendered value the moment we know an animation is
    // coming. Without this the number renders in full, then snaps to zero on
    // the first spring frame when it scrolls into view — a visible glitch, and
    // the reason this cannot simply render 0 on the server instead: that would
    // leave `0` on the page for anyone whose JS never runs.
    const node = ref.current;
    if (node) node.textContent = "0";

    // `textContent` directly rather than through state: this fires every
    // animation frame, and a `setState` per frame would re-render the block
    // sixty times a second to change one string.
    return spring.on("change", (current) => {
      const live = ref.current;
      if (live) live.textContent = format(Math.round(current));
    });
  }, [reduced, spring]);

  return (
    <span className={className}>
      {/* The real value is what the server renders and what assistive tech
          reads. If the effect never runs — no JS, reduced motion, never
          scrolled into view — this is already correct. */}
      <span ref={ref}>{format(reduced ? value : 0)}</span>
      {suffix ? <span aria-hidden>{suffix}</span> : null}
    </span>
  );
}

function format(value: number): string {
  // Grouping separators from the server would have to match the client's locale
  // or React reports a hydration mismatch, so this pins one format rather than
  // asking `toLocaleString` what the runtime thinks.
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

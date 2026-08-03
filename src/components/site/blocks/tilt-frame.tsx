"use client";

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

import { useReducedMotion } from "./use-reduced-motion";

/**
 * Pointer-tracked 3D tilt — react-bits `TiltedCard`, adapted.
 *
 * WHAT CHANGED FROM THE ORIGINAL, AND WHY (see docs/site-components.md §3):
 *
 * - **It wraps children instead of taking `imageSrc`.** The original owns its
 *   own `<img>`, which would move the image into the client bundle and out of
 *   the server-rendered HTML. Here the markup stays in the server component and
 *   only the transform is client-side, so the picture is in the document for a
 *   crawler, for a reader with JS off, and on the first paint.
 * - **No fixed `containerHeight`/`containerWidth`.** The original defaults to
 *   300px square. A bento cell is whatever its split ratios make it.
 * - **`showMobileWarning` is gone.** It defaults to ON upstream and renders a
 *   literal "This effect is not optimized for mobile" banner — a demo affordance
 *   that would otherwise ship onto strangers' pages.
 * - **Reduced motion returns a plain `<div>`**, with no listeners attached at
 *   all rather than a zeroed-out animation.
 *
 * Touch devices get nothing, which is correct and not a gap: there is no hover
 * to track, and wiring this to touchmove would mean fighting the page scroll for
 * an effect nobody asked for.
 */
export function TiltFrame({
  children,
  className = "",
  amplitude = 10,
}: {
  children: ReactNode;
  className?: string;
  /** Max rotation in degrees at the far edge. */
  amplitude?: number;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  // Hooks cannot be conditional, so the motion values are always created; what
  // `reduced` decides is whether anything ever writes to them.
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 300, damping: 28, mass: 0.6 };
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [amplitude, -amplitude]), spring);
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-amplitude, amplitude]), spring);

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      // `perspective` has to sit on the transformed element itself here rather
      // than on a parent: a bento cell's parent is a flex pane shared with a
      // sibling block, and a perspective there would apply to both.
      style={{ perspective: 800, rotateX, rotateY, transformStyle: "preserve-3d" }}
      className={className}
      onPointerMove={(event) => {
        // Pointer events, not mouse events, and pen is welcome. `pointerType`
        // filters out the synthetic touch pointers that would otherwise make
        // the card lurch on every tap-scroll.
        if (event.pointerType === "touch") return;
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        x.set((event.clientX - box.left) / box.width - 0.5);
        y.set((event.clientY - box.top) / box.height - 0.5);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

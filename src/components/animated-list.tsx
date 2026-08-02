"use client";

import { useRef } from "react";
import { LazyMotion, domAnimation, useInView, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

/**
 * AnimatedList — React Bits' staggered list reveal, adapted the same way
 * ProfileCard was: upstream's motion, this app's language and constraints.
 *
 * ── Why this is a wrapper and not upstream's component ────────────────────────
 *
 * Upstream owns its markup: it takes `items: string[]` and renders a <p> per
 * entry inside a fixed 500×400 inner-scrolling box. Every list in this app is
 * server-rendered and every row carries real interactive controls — a profile
 * link, Save, a ••• menu — so the rows cannot be strings and must not be
 * re-rendered on the client. So `AnimatedList` is a <ul> and `AnimatedListItem`
 * is the animated <li>; the row content stays exactly where it was, server
 * components included, and only the wrapper ships to the browser.
 *
 * ── What was deliberately not carried over, and why ───────────────────────────
 *
 * `enableArrowNavigation` — upstream binds a `window` keydown listener that
 *   calls preventDefault() on Tab. That disables Tab for the WHOLE PAGE, not
 *   just the list, and these rows contain the only controls on the screen. It
 *   is a keyboard trap; it is not shipped.
 *
 * `scale: 0.7` on entry — scaling an element scales its box-shadow with it, and
 *   in this language the offset shadow is a fixed 4px that says "this is a
 *   card". Mid-flight it would read as 2.8px and the card would look like it was
 *   inflating. Translate + fade instead, on the same 8px rise the shell already
 *   uses for page content, so the offset never moves.
 *
 * `showGradients` — the top/bottom fades are hardcoded #120F17 (upstream is a
 *   dark theme) and, more to the point, this design language has no gradients in
 *   it at all. An edge is an edge here.
 *
 * hover-to-select — upstream tints the row the pointer is over. Rows already
 *   have press feedback via `nb-row`, and a hover tint is the thing this app
 *   just removed from ProfileCard.
 *
 * the inner scroll container — the page scrolls, not a box inside it. The tab
 *   bar's bottom padding is calculated against page scroll, and a nested
 *   scroller on a phone swallows the gesture that was meant for the page.
 *
 * ── One upstream bug worth knowing about ──────────────────────────────────────
 *
 * Upstream passes `{ amount: 0.5, triggerOnce: false }` to `useInView`. The
 * option is spelled `once`, so `triggerOnce` is silently ignored and the value
 * it wanted was the default anyway — every row re-animates each time it scrolls
 * out and back, which on a list you scroll up and down is a flicker. `once` is
 * set properly here, so a row reveals once and then stays put.
 */

/**
 * The <ul>. Layout classes stay with the caller — this adds no styling.
 *
 * The LazyMotion wrapper is a bundle decision, not a structural one. Importing
 * `motion` the way upstream does pulls the full feature set into the shared
 * chunk. Measured on this app, gzipped, over all static chunks:
 *
 *   no animation   347.2kB
 *   LazyMotion + m 372.8kB   (+25.6)
 *   full `motion`  386.0kB   (+38.8)
 *
 * `m` plus `domAnimation` covers exactly what this component uses — opacity and
 * transform, no layout projection, no drag, no SVG path morphing. `strict` makes
 * the cheap path enforceable: importing `motion.*` under this provider throws
 * rather than silently pulling the full bundle back in.
 *
 * 25.6kB for two fades is still not cheap, and it is the whole price of this
 * feature — nothing else in the app uses motion. If that stops being worth it,
 * the same reveal is achievable in CSS for nothing: `nb-rise` in globals.css is
 * already the identical 8px-and-fade, and a per-item `animation-delay` would
 * cover the stagger. The tradeoff is losing in-view triggering, so rows below
 * the fold would animate on load instead of on scroll.
 *
 * If a future component here needs layout animations it needs `domMax`, not a
 * return to the whole library.
 *
 * LazyMotion renders no DOM node of its own, so the <ul> still directly contains
 * the <li> children and the markup stays valid.
 */
export function AnimatedList({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <ul className={className}>{children}</ul>
    </LazyMotion>
  );
}

export function AnimatedListItem({
  index,
  className = "",
  children,
}: {
  /** Position in the list, for the stagger. */
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const reduced = useReducedMotion();
  /**
   * `amount: 0.15` rather than upstream's 0.5: these rows are tall enough that
   * requiring half of one to be visible means the last row on screen stays
   * invisible until you scroll, which reads as a missing row rather than as an
   * animation.
   */
  const inView = useInView(ref, { amount: 0.15, once: true });

  /**
   * The stagger, capped. Upstream passes a constant `delay={0.1}` to every item,
   * which is not a stagger at all — every row moves at once. Scaling by index
   * gives a real cascade, but uncapped a 60-row list would leave the last row
   * waiting three seconds, so past the first screenful they all share the
   * maximum. Below the fold the scroll position is doing the staggering anyway.
   */
  const delay = Math.min(index, 6) * 0.045;

  /**
   * Reduced motion keeps the fade and drops the travel, matching the global
   * policy in globals.css: feedback stays, movement goes.
   *
   * `y` STAYS IN BOTH OBJECTS and is zeroed rather than omitted, which is not a
   * style preference — omitting it strands the row 8px low. `useReducedMotion`
   * returns null on the first render and its real value only after hydration, so
   * a reduced-motion visitor gets `initial={{ y: 8 }}` written to the element on
   * render one, and then an animate target that no longer mentions `y` at all.
   * Motion animates what it is given; a property that disappears from the target
   * is simply left wherever it was. Every row would sit 8px below its own
   * spacing, permanently, for exactly the people who asked for less movement.
   */
  const hidden = { opacity: 0, y: reduced ? 0 : 8 };
  const shown = { opacity: 1, y: 0 };

  return (
    <m.li
      ref={ref}
      className={className}
      initial={hidden}
      animate={inView ? shown : hidden}
      // --dur-enter / --ease-out from globals.css, inlined because motion needs
      // numbers rather than CSS custom properties.
      transition={{ duration: 0.22, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </m.li>
  );
}

"use client";

import { useSyncExternalStore } from "react";

/**
 * `prefers-reduced-motion: reduce`, live.
 *
 * Every animated block on a public page goes through this, and it is a
 * correctness requirement rather than a nicety: pointer-tracked tilt, springy
 * counters and staggered entrances are vestibular triggers, and this is a page
 * strangers open from a QR code without choosing to. None of the react-bits
 * originals do this, so it lives in one hook instead of at seven call sites.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, for the reason
 * the pattern exists: a media query IS an external store, and reading it in an
 * effect means one render with the wrong answer before the right one. The
 * server snapshot is `true` — the server cannot know the preference, so the
 * first paint has to guess, and the safe guess is the still one. A viewer who
 * asked for less motion must never get a frame of it while React catches up;
 * anyone who did not ask loses at most one entrance animation.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

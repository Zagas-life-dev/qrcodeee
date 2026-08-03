"use client";

import { AnimatePresence, motion } from "motion/react";

import { useSiteStore } from "@/lib/site/store";
import { useReducedMotion } from "@/components/site/blocks/use-reduced-motion";

/**
 * What the save queue is doing, for the person doing the editing.
 *
 * THE HONESTY PROBLEM THIS SOLVES. An optimistic editor shows every change
 * instantly, which means the screen looks identical whether the change reached
 * the server or is sitting in a queue on a phone with no signal. That is a good
 * trade only if the difference is stated somewhere — otherwise the interface is
 * quietly lying about durability, and the person finds out when they open their
 * page on a laptop and half their work is missing.
 *
 * So: nothing at rest, a quiet marker while sending, and something you cannot
 * miss when the connection has gone. Three states, in ascending order of how
 * much they interrupt, matching how much the user actually needs to act.
 *
 * IT NO LONGER STICKS TO THE VIEWPORT ITSELF. It used to, for the right reason —
 * the editor is taller than a phone screen and the failure it reports can happen
 * while you are at the bottom of it. It now lives in the editor toolbar, which
 * is sticky, so the same guarantee holds with one pinned element on screen
 * instead of two stacked on each other.
 */
export function SyncStatus() {
  const { sync } = useSiteStore();
  const still = useReducedMotion();

  const state = sync.offline ? "offline" : sync.pending > 0 ? "saving" : "idle";

  return (
    <div
      // `aria-live` on the container rather than the message: a live region has
      // to be in the accessibility tree BEFORE the text appears, or the change
      // that would be announced is the region itself arriving.
      role="status"
      aria-live="polite"
      // A real flex item rather than `display: contents` — a live region that
      // stops generating a box is a live region some engines drop from the
      // accessibility tree, which is the one thing this element cannot afford.
      // `empty:hidden` keeps it from occupying a gap in the toolbar at rest.
      className="flex items-center empty:hidden"
    >
      <AnimatePresence initial={false} mode="wait">
        {state === "offline" ? (
          <motion.div
            key="offline"
            initial={still ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap items-center gap-2 rounded-full border-2 border-ink bg-lemon px-3 py-1 shadow-brutal-sm"
          >
            <p className="text-xs font-semibold">
              Offline —{" "}
              <span className="font-medium">
                {sync.pending === 1 ? "1 change" : `${sync.pending} changes`} saved on
                this device
              </span>
            </p>
            <button
              type="button"
              onClick={sync.retry}
              className="min-h-7 shrink-0 rounded-full border-2 border-ink bg-paper px-2.5 text-xs font-semibold nb-press-sm"
            >
              Try now
            </button>
          </motion.div>
        ) : null}

        {state === "saving" ? (
          <motion.p
            key="saving"
            initial={still ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-paper px-3 py-1 text-xs font-semibold shadow-brutal-sm"
          >
            {/* The only moving thing in the editor's chrome, and it moves for a
                reason: this appears and disappears within a second or two, which
                without motion reads as a flicker rather than as progress. */}
            <motion.span
              aria-hidden
              className="size-2 rounded-full bg-ink"
              animate={still ? undefined : { opacity: [1, 0.25, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
            Saving…
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

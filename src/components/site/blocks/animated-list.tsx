"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";

import { useReducedMotion } from "./use-reduced-motion";
import type { ListContent } from "@/lib/site/blocks";
import { USER_LINK_REL } from "../link-rel";

/**
 * A list whose rows fade and rise in — react-bits `AnimatedList`, adapted.
 *
 * WHAT CHANGED:
 *
 * - **`items` is `{ text, url }[]`, not `string[]`.** The original is a demo
 *   shape; a reading list, a now-playing list or a set of press mentions all
 *   want the row to be a link.
 * - **The scroll container and gradient masks are gone.** They exist upstream
 *   to demo a long list in a fixed box. A bento cell is already a box with its
 *   own height, and a second scroll region inside a page that scrolls is a trap
 *   on touch.
 * - **`onItemSelect` and the keyboard arrow navigation are gone.** They make
 *   the list a listbox — a selection control. This one is content, and rows
 *   that are links are already reachable by Tab.
 *
 * The stagger is kept, which is the whole point of the component, and it is
 * driven by `useInView` so a list far down the page animates when it is reached
 * rather than while it is still off screen.
 */
export function AnimatedList({ content }: { content: ListContent }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLUListElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <ul ref={ref} className="flex flex-col gap-[0.5em]">
      {content.items.map((item, index) => (
        <motion.li
          key={index}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={reduced || inView ? { opacity: 1, y: 0 } : undefined}
          transition={{
            duration: 0.32,
            // Capped so a full twenty-row list finishes in about a second
            // instead of trickling for four.
            delay: Math.min(index * 0.05, 0.6),
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Row text={item.text} url={item.url} />
        </motion.li>
      ))}
    </ul>
  );
}

function Row({ text, url }: { text: string; url: string | null }) {
  const shell =
    "sk-surface flex min-h-11 items-center gap-3 px-3.5 py-2.5 text-sm font-medium";

  if (!url) {
    return <div className={shell}>{text}</div>;
  }

  return (
    <a href={url} target="_blank" rel={USER_LINK_REL} className={`${shell} nb-press-sm`}>
      <span className="min-w-0 flex-1">{text}</span>
      <span aria-hidden className="shrink-0">
        ↗
      </span>
    </a>
  );
}

"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";

import { SOCIAL_NETWORKS, socialUrl, type SocialsContent } from "@/lib/site/blocks";
import { SocialIcon } from "@/lib/site/social-icons";

import { USER_LINK_REL } from "../link-rel";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Socials as a magnifying dock — react-bits `Dock`, adapted.
 *
 * WHAT CHANGED:
 *
 * - **It takes socials, not `{icon, label, onClick}[]`.** Upstream is a
 *   launcher; these are links, so they are anchors and they are navigable by
 *   Tab without any of the keyboard handling a div-with-onClick would need.
 * - **`panelHeight`/`baseItemSize` are gone.** Sizes come from the block's own
 *   `em`, so a dock in a scaled-up block scales with it instead of staying
 *   36px while everything around it grows.
 * - **Touch gets a plain row.** The magnification tracks a pointer along the
 *   dock's axis, and there is no such pointer on a phone. Upstream animates
 *   from touch coordinates anyway, which on a tap-scroll makes the icons heave.
 *
 * THE LABEL IS NOT DROPPED, it moves. A chip shows mark + name side by side; a
 * dock cannot, so each anchor keeps an `aria-label` and a `title`. Losing the
 * accessible name is the one thing an icon-only row must not do.
 */
export function SocialDock({ content }: { content: SocialsContent }) {
  const reduced = useReducedMotion();
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);

  return (
    <nav aria-label="Social links" className="flex h-full items-center justify-center">
      <ul
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          mouseX.set(event.clientX);
        }}
        onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        className="sk-surface flex items-end gap-[0.5em] px-[0.75em] py-[0.5em]"
      >
        {content.items.map((item, index) => (
          <DockItem
            key={index}
            mouseX={mouseX}
            reduced={reduced}
            href={socialUrl(item.network, item.handle)}
            label={`${SOCIAL_NETWORKS[item.network].label} — @${item.handle}`}
          >
            <SocialIcon network={item.network} className="size-[1.5em]" />
          </DockItem>
        ))}
      </ul>
    </nav>
  );
}

function DockItem({
  mouseX,
  reduced,
  href,
  label,
  children,
}: {
  mouseX: MotionValue<number>;
  reduced: boolean;
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  // Distance from the pointer to this item's centre, in px. `Infinity` — the
  // resting value — lands outside the input range, so the transform returns the
  // base size and nothing moves until a pointer is actually over the dock.
  const distance = useTransform(mouseX, (x) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return Number.POSITIVE_INFINITY;
    return x - box.x - box.width / 2;
  });

  const size = useSpring(useTransform(distance, [-120, 0, 120], [1, 1.7, 1]), {
    stiffness: 320,
    damping: 24,
    mass: 0.3,
  });

  return (
    <li className="flex items-end">
      <motion.a
        ref={ref}
        href={href}
        target="_blank"
        rel={USER_LINK_REL}
        aria-label={label}
        title={label}
        // Under reduced motion the scale is never written, so this is a plain
        // row of icons — which is a perfectly good socials block, not a
        // degraded one.
        style={reduced ? undefined : { scale: size }}
        className="sk-chip flex size-[2.5em] items-center justify-center"
      >
        {children}
      </motion.a>
    </li>
  );
}

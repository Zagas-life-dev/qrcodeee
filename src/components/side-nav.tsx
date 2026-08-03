"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isActivePath } from "./nav-items";

/**
 * The desktop rail (`lg` and up), and the reason this app stops being a phone
 * app stretched to 768px.
 *
 * WHAT IT FIXES. Every page was a single `max-w-lg` column centred on whatever
 * the display happened to be, with navigation living in a row of pills that had
 * to stay short enough to fit beside the brand. On a laptop that left two thirds
 * of the viewport as empty canvas and hid `/site` entirely for want of a sixth
 * pill. A rail costs 16rem of width once, gives every destination a full name
 * and a line of explanation, and hands the rest of the screen back to the page.
 *
 * SOLID PAPER, NOT GLASS. The rail is sticky and the content scrolls BESIDE it,
 * never underneath — so there is nothing behind it to frost, and glass here
 * would be a compositing layer producing a slightly lighter yellow (see the
 * Glass rules in globals.css). The paper fill against the gridded canvas is also
 * what makes the work area read as a work area.
 *
 * The dock (`sm:hidden`) and the header row (`sm` to `lg`) are the same list at
 * smaller sizes; all three read `NAV_ITEMS`.
 */
export function SideNav({ handle }: { handle: string | null }) {
  const pathname = usePathname();

  return (
    <aside
      // Named so view transitions pin it exactly as they pin the header and the
      // dock — a rail that slides on every navigation would remove the one
      // still reference point telling you the CONTENT changed.
      style={{ viewTransitionName: "shell-side" }}
      className="shell-side hidden w-64 shrink-0 border-r-2 border-ink bg-paper lg:block"
    >
      <nav aria-label="Main" className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-5">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              /* Border on both states, transparent when idle: a border that
                 appears on hover would shift the label by 2px, and this list is
                 six rows of exactly that jitter. */
              className={`flex items-center gap-3 rounded-full border-2 px-3 py-2 transition-colors duration-[--dur-fast] ${
                active
                  ? "border-ink bg-lilac shadow-brutal-sm"
                  : "border-transparent hover:border-ink hover:bg-canvas/60"
              }`}
            >
              <item.Icon className="size-5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.label}</span>
                {/* The rail is the only surface with room for this, and it is
                    what turns a six-item list into something you can read
                    once and never think about again. */}
                <span className="block truncate text-xs font-medium text-ink/70">
                  {item.hint}
                </span>
              </span>
            </Link>
          );
        })}

        {/* The public link, pinned to the bottom. It is the one thing in the app
            that lives OUTSIDE it, so it gets the external-link treatment rather
            than a nav row — and it is genuinely useful to have one click away
            while editing the page it points at. */}
        {handle ? (
          <a
            href={`/u/${handle}`}
            target="_blank"
            rel="noreferrer"
            className="mt-auto rounded-brutal border-2 border-ink bg-canvas p-3 shadow-brutal-sm nb-press-sm"
          >
            <span className="block font-display text-xs tracking-wide uppercase">
              Your public link
            </span>
            <span className="mt-1 block truncate font-mono text-xs">/u/{handle}</span>
            <span className="mt-1 block text-xs font-semibold">Open it ↗</span>
          </a>
        ) : null}
      </nav>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, currentNavLabel, isActivePath } from "./nav-items";
import { SkanMark } from "./brand";
import { NotificationBell } from "./notification-bell";

/**
 * The top bar. Three jobs at three sizes.
 *
 * PHONE — a slim identity strip: brand, and the notification bell that has
 * nowhere else to live once navigation moves to the bottom dock.
 *
 * TABLET (`sm` to `lg`) — it absorbs the dock's destinations inline, because a
 * thumb-reach bar on a pointer device is a strip of wasted viewport.
 *
 * DESKTOP (`lg` up) — the inline row goes away again and the rail takes over
 * (side-nav.tsx). What is left is the corner brand sitting above the rail and
 * the name of the current section, which is the piece that makes this read as an
 * application shell rather than as a website header. The brand's box is pinned
 * to the rail's width so the two line up as one column.
 *
 * FULL-BLEED FROM `lg`, and that is the whole point of the change: the bar used
 * to be `max-w-3xl` and centred, so on a wide display the brand floated in the
 * middle of the screen with the rail's edge nowhere near it.
 *
 * Sticky rather than fixed: it keeps the bell reachable while scrolling a long
 * connections list without needing a scroll-position listener to hide it.
 */
export function SiteHeader({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const pathname = usePathname();
  const section = currentNavLabel(pathname);

  return (
    <header
      style={{ viewTransitionName: "shell-header" }}
      // Frosted rather than solid paper: this bar is sticky, so the gridded
      // canvas and every card on it genuinely pass underneath — which is the
      // one condition glass is allowed under here. The 2px ink underline stays
      // exactly as it was; only the fill changed.
      className="nb-glass-chrome sticky top-0 z-40 border-b-2 border-ink pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2.5 sm:px-6 lg:max-w-none lg:gap-4 lg:px-0">
        {/* The brand lockup, on the lilac pill the primary actions use. The
            mark's letter counter is paper, which is why it needs a fill behind
            it rather than sitting bare on the white header — on paper the S
            would read as an outline with nothing inside it. */}
        <div className="flex shrink-0 items-center lg:w-64 lg:px-3">
          <Link
            href="/qr"
            className="flex shrink-0 items-center gap-2 rounded-full border-2 border-ink bg-lilac py-1.5 pr-3.5 pl-2 shadow-brutal-sm nb-press-sm"
          >
            <SkanMark className="size-6 shrink-0" />
            <span className="font-display text-sm leading-none tracking-tight">Skan QR</span>
          </Link>
        </div>

        {/* Phone navigation is the dock and desktop navigation is the rail;
            this row exists for the sizes that have neither. */}
        <ul className="hidden items-center gap-1.5 sm:flex lg:hidden">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-full border-2 border-ink px-3 py-1.5 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
                    active ? "bg-lilac" : "bg-paper"
                  }`}
                >
                  {/* `short` here and `label` in the rail: six full names do
                      not fit beside the brand and the bell on a tablet. */}
                  {item.short}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Desktop only, and deliberately not an <h1> — the page owns that. This
            is a location indicator, which is what the rail's highlight also
            says; saying it twice is what makes a shell feel oriented. */}
        {section ? (
          <p className="hidden font-display text-lg leading-none tracking-tight lg:block">
            {section}
          </p>
        ) : null}

        <div className="ml-auto flex items-center lg:pr-6">
          <NotificationBell userId={userId} initialCount={initialUnread} />
        </div>
      </div>
    </header>
  );
}

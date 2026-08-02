"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SkanMark } from "./brand";
import { NotificationBell } from "./notification-bell";

/**
 * The top bar.
 *
 * Two jobs at two sizes. On a phone it is a slim identity strip — brand, and the
 * notification bell that has nowhere else to live once navigation moves to the
 * bottom. From `sm` up it absorbs the tab bar's destinations and the bottom bar
 * disappears, because a thumb-reach bar on a desktop pointer is just a strip of
 * wasted viewport.
 *
 * Sticky rather than fixed: it keeps the bell reachable while scrolling a long
 * connections list without needing a scroll-position listener to hide it.
 */
const LINKS = [
  { href: "/qr", label: "My code" },
  { href: "/scan", label: "Scan" },
  { href: "/connections", label: "Connections" },
  { href: "/analytics", label: "Analytics" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const pathname = usePathname();

  return (
    <header
      style={{ viewTransitionName: "shell-header" }}
      // Frosted rather than solid paper: this bar is sticky, so the gridded
      // canvas and every card on it genuinely pass underneath — which is the
      // one condition glass is allowed under here. The 2px ink underline stays
      // exactly as it was; only the fill changed.
      className="nb-glass-chrome sticky top-0 z-40 border-b-2 border-ink pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2.5 sm:px-6">
        {/* The brand lockup, on the lilac pill the primary actions use. The
            mark's letter counter is paper, which is why it needs a fill behind
            it rather than sitting bare on the white header — on paper the S
            would read as an outline with nothing inside it. */}
        <Link
          href="/qr"
          className="flex shrink-0 items-center gap-2 rounded-full border-2 border-ink bg-lilac py-1.5 pr-3.5 pl-2 shadow-brutal-sm nb-press-sm"
        >
          <SkanMark className="size-6 shrink-0" />
          <span className="font-display text-sm leading-none tracking-tight">Skan QR</span>
        </Link>

        {/* Phone navigation is the tab bar; these are the same destinations for
            pointer-sized screens, where there is room for them inline. */}
        <ul className="hidden items-center gap-1.5 sm:flex">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-full border-2 border-ink px-3 py-1.5 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
                    active ? "bg-lilac" : "bg-paper"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <NotificationBell userId={userId} initialCount={initialUnread} />
      </div>
    </header>
  );
}

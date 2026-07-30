"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      className="sticky top-0 z-40 border-b-2 border-ink bg-paper pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2.5 sm:px-6">
        <Link
          href="/qr"
          className="shrink-0 rounded-brutal border-2 border-ink bg-lemon px-3 py-1.5 font-display text-sm shadow-brutal-sm nb-press-sm"
        >
          QR Connect
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
                  className={`block rounded-brutal border-2 border-ink px-3 py-1.5 text-sm font-bold shadow-brutal-sm nb-press-sm ${
                    active ? "bg-lemon" : "bg-paper"
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

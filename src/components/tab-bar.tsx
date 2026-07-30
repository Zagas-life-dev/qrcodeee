"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChartIcon, PeopleIcon, PersonIcon, QrIcon, ScanIcon } from "./nav-icons";

/**
 * The phone-sized navigation (`sm:hidden` — the header carries these same
 * destinations on wider screens).
 *
 * Bottom-anchored because that is where thumbs are. The old top strip put five
 * destinations in a horizontally-scrolling row at the far end of a one-handed
 * reach, where the last two were both hard to hit and easy to miss entirely.
 *
 * Scan is the raised centre action rather than a fifth equal tab: it is the one
 * thing this product exists to do, and it is the only destination someone opens
 * while standing in front of another person.
 */
const TABS = [
  { href: "/qr", label: "My code", Icon: QrIcon },
  { href: "/connections", label: "People", Icon: PeopleIcon },
  { href: "/analytics", label: "Stats", Icon: ChartIcon },
  { href: "/profile", label: "Profile", Icon: PersonIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      // viewTransitionName pins this so it doesn't travel with the page content
      // — see the ::view-transition rules in globals.css.
      style={{ viewTransitionName: "shell-tabs" }}
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch justify-between px-2">
        {TABS.slice(0, 2).map((tab) => (
          <Tab key={tab.href} {...tab} pathname={pathname} />
        ))}

        <li className="flex flex-1 justify-center">
          <Link
            href="/scan"
            aria-label="Scan a code"
            aria-current={isActive(pathname, "/scan") ? "page" : undefined}
            className="group flex flex-col items-center gap-1 pt-1 pb-2"
          >
            {/* Breaks the bar's top edge on purpose. A raised action that stays
                inside its container is just a slightly bigger tab. */}
            <span
              className={`-mt-7 flex size-14 items-center justify-center rounded-full border-2 border-ink shadow-brutal nb-press-raise ${
                isActive(pathname, "/scan") ? "bg-ink text-paper" : "bg-lemon text-ink"
              }`}
            >
              <ScanIcon className="size-7" />
            </span>
            <span className="text-[10px] font-bold">Scan</span>
          </Link>
        </li>

        {TABS.slice(2).map((tab) => (
          <Tab key={tab.href} {...tab} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

function Tab({
  href,
  label,
  Icon,
  pathname,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  pathname: string;
}) {
  const active = isActive(pathname, href);

  return (
    <li className="flex flex-1">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        // min-h-14 keeps every tab at or above the 44px touch minimum even
        // though the glyph and its label together are shorter than that.
        className="flex min-h-14 w-full flex-col items-center gap-1 rounded-brutal px-1 pt-2 pb-2"
      >
        {/* The active pill is a filled, outlined shape rather than a colour
            change: on a yellow canvas a tinted glyph at this size is nearly
            impossible to pick out, and the fill also survives greyscale. */}
        <span
          className={`flex h-7 w-11 items-center justify-center rounded-full border-2 transition-colors duration-[--dur-fast] ${
            active ? "border-ink bg-lemon" : "border-transparent"
          }`}
        >
          <Icon className="size-5" />
        </span>
        <span className={`text-[10px] ${active ? "font-bold" : "font-medium"}`}>
          {label}
        </span>
      </Link>
    </li>
  );
}

/** `/connections/abc` keeps the People tab lit; `/` never matches anything. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

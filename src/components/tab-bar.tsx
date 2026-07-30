"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChartIcon, PeopleIcon, PersonIcon, QrIcon, ScanIcon } from "./nav-icons";

/**
 * The phone-sized navigation, as a floating dock (`sm:hidden` — the header
 * carries these same destinations on wider screens).
 *
 * A detached pill rather than a full-width bar welded to the bottom edge, per
 * docs/images (1).jpg. Brutalism survives the shape change intact: the dock
 * keeps the 2px ink outline and the hard zero-blur offset shadow, and the
 * reference's soft drop shadow is the one thing deliberately NOT carried over.
 * A pill is just a radius; the language lives in the border and the offset.
 *
 * Floating buys something real beyond looks — the page scrolls visibly past it
 * on both sides, so it reads as sitting above the content rather than cropping
 * it, and the rounded ends stop the bar from looking like a torn-off edge on a
 * device with no home indicator.
 */
const TABS = [
  { href: "/qr", label: "My code", Icon: QrIcon },
  { href: "/connections", label: "People", Icon: PeopleIcon },
  { href: "/scan", label: "Scan", Icon: ScanIcon, primary: true },
  { href: "/analytics", label: "Stats", Icon: ChartIcon },
  { href: "/profile", label: "Profile", Icon: PersonIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    // The wrapper spans the viewport so the dock can centre in it, but takes no
    // pointer events — without that, the transparent gutters either side of the
    // pill would swallow taps meant for the content scrolling underneath.
    <div
      style={{ viewTransitionName: "shell-tabs" }}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:hidden"
    >
      <nav
        aria-label="Main"
        className="pointer-events-auto mx-auto flex w-full max-w-sm items-center justify-between gap-1 rounded-full border-2 border-ink bg-paper px-2.5 py-2.5 shadow-brutal"
      >
        {TABS.map((tab) => (
          <Tab key={tab.href} {...tab} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}

function Tab({
  href,
  label,
  Icon,
  primary,
  pathname,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  primary?: boolean;
  pathname: string;
}) {
  const active = isActive(pathname, href);

  /**
   * Scan is the solid centre action, per the reference. It is ink-filled rather
   * than lemon precisely BECAUSE lemon is what marks the current page — the two
   * would otherwise be the same circle, and an unvisited Scan would read as
   * "you are here". Ink says primary, lemon says current, and when Scan is both
   * it takes lemon like every other tab.
   */
  const fill = active
    ? "border-ink bg-lemon text-ink"
    : primary
      ? "border-ink bg-ink text-paper"
      : "border-transparent text-ink";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // size-11 is the 44px touch minimum, and the icons are the only labels in
      // the dock — so the accessible name comes from the sr-only span rather
      // than from an aria-label that would leave the link nameless with CSS off.
      className={`flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-[--dur-fast] ${fill}`}
    >
      <Icon className={primary ? "size-6" : "size-5"} />
      <span className="sr-only">{label}</span>
    </Link>
  );
}

/** `/connections/abc` keeps the People tab lit; `/` never matches anything. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

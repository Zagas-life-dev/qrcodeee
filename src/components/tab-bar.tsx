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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:hidden">
      <nav
        aria-label="Main"
        /**
         * `view-transition-name` sits HERE rather than on the wrapper, and that
         * is load-bearing for the frosted fill, not a tidy-up.
         *
         * A named element becomes a backdrop root. With the name on the wrapper,
         * this nav's backdrop-filter sampled only the wrapper's own contents —
         * which is this nav and nothing else — so the blur computed correctly
         * and rendered as absolutely nothing, leaving page text crisply legible
         * straight through the dock. On the nav, the backdrop root is the page
         * again and the blur has the scrolling content to work on.
         *
         * It is also the more correct capture: the wrapper is a transparent
         * full-width box, the pill is the thing anyone can actually see move.
         */
        style={{ viewTransitionName: "shell-tabs" }}
        // Frosted, for the same reason the header is: the dock is detached and
        // the page scrolls visibly past it on both sides, so there is always
        // something behind it. It keeps the ink outline and the hard offset —
        // the shadow is what still says brutalism while the fill says glass.
        className="nb-glass-chrome pointer-events-auto mx-auto flex w-full max-w-sm items-center justify-between gap-1 rounded-full border-2 border-ink px-2.5 py-2.5 shadow-brutal"
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
   * than lilac precisely BECAUSE lilac is what marks the current page — the two
   * would otherwise be the same circle, and an unvisited Scan would read as
   * "you are here". Ink says primary, lilac says current, and when Scan is both
   * it takes lilac like every other tab.
   */
  const fill = active
    ? "border-ink bg-lilac text-ink"
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

import {
  ChartIcon,
  PageIcon,
  PeopleIcon,
  PersonIcon,
  QrIcon,
  ScanIcon,
} from "./nav-icons";

/**
 * The app's destinations, in one place.
 *
 * There are now three navigations rendering the same set — the phone dock, the
 * tablet header row and the desktop rail — and before this they each kept their
 * own array. They had already drifted: `/site` existed in none of them, so the
 * page editor was reachable only from a link buried in the profile form, and the
 * header called `/qr` "My code" while the dock called it the same thing by
 * accident rather than by construction.
 *
 * `label` is the full name (rail, header). `short` is what fits a 44px dock
 * button's accessible name and the header at its tightest. Both are written out
 * rather than derived, because "Connections"/"People" is an editorial choice per
 * surface, not a truncation.
 */
export type NavItem = {
  href: string;
  label: string;
  short: string;
  /** One line, rail only — the header and dock have no room for it. */
  hint: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  /** The dock's filled centre action. Exactly one item may set this. */
  primary?: boolean;
};

/**
 * Order matters, and it is the DOCK's order: Scan sits in the middle of the row
 * because it is the filled centre action the phone layout is built around (see
 * tab-bar.tsx). The rail and the header row inherit that order rather than
 * sorting themselves, so a destination is in the same relative place at every
 * size — which is most of what makes navigation learnable.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/qr",
    label: "My code",
    short: "My code",
    hint: "The code people scan",
    Icon: QrIcon,
  },
  {
    href: "/connections",
    label: "Connections",
    short: "People",
    hint: "Everyone you've met",
    Icon: PeopleIcon,
  },
  {
    href: "/scan",
    label: "Scan",
    short: "Scan",
    hint: "Point at someone's code",
    Icon: ScanIcon,
    primary: true,
  },
  {
    href: "/site",
    label: "Your page",
    short: "Page",
    hint: "What your link shows",
    Icon: PageIcon,
  },
  {
    href: "/analytics",
    label: "Analytics",
    short: "Stats",
    hint: "Growth and reach",
    Icon: ChartIcon,
  },
  {
    href: "/profile",
    label: "Profile",
    short: "Profile",
    hint: "Your details and account",
    Icon: PersonIcon,
  },
];

/**
 * `/connections/abc` keeps Connections lit; `/` never matches anything.
 *
 * Shared rather than copied into each nav — it was already duplicated in two
 * files, and an active-state rule that disagrees between the rail and the dock
 * is the kind of bug nobody reports.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The current destination's name, for the desktop header's context line. */
export function currentNavLabel(pathname: string): string | null {
  return NAV_ITEMS.find((item) => isActivePath(pathname, item.href))?.label ?? null;
}

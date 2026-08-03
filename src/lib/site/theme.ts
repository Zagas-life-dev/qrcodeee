/**
 * Page appearance (site-spec S7).
 *
 * A SKIN IS AN ID, NOT A STYLESHEET. `sites.theme` stores `{skin, font}` and
 * nothing else — no colours, no CSS, no class names. Every value is a key into
 * a closed set defined here, and the actual declarations live in globals.css
 * under `[data-skin="…"]`.
 *
 * That is the whole security design and it is not paranoia. "Let people
 * customise their page" is one careless step away from storing CSS that a
 * stranger's browser then executes — `url(javascript:…)`, a `position:fixed`
 * overlay across the Save-contact button, `content` that fabricates a payment
 * prompt. An enum of six cannot express any of those. It is the same narrowing
 * as `SOCIAL_NETWORKS`: the user picks WHICH, we own WHAT.
 *
 * The cost is real and worth naming: nobody can pick an arbitrary accent
 * colour. Six curated skins whose contrast we have actually checked is the
 * trade, and a colour picker would put that check on the person least equipped
 * to make it.
 */

export const SITE_SKINS = {
  neo: {
    label: "Neo-brutalist",
    hint: "Hard borders, flat colour, offset shadows.",
  },
  minimal: {
    label: "Minimal",
    hint: "Mostly whitespace. Nothing competes with the words.",
  },
  glass: {
    label: "Glass",
    hint: "Frosted translucent panels over a deep gradient.",
  },
  clay: {
    label: "Clay",
    hint: "Soft, rounded, pressed-out-of-putty.",
  },
  maximal: {
    label: "Maximal",
    hint: "Loud colour, thick edges, no restraint.",
  },
  skeu: {
    label: "Skeuomorphic",
    hint: "Bevels, gradients and a bit of 2008.",
  },
} as const;

export type SiteSkin = keyof typeof SITE_SKINS;
export const DEFAULT_SKIN: SiteSkin = "neo";

/**
 * Fonts are keys too, for the same reason — and because a font is a NETWORK
 * REQUEST. An arbitrary family name would either resolve to nothing or, with a
 * URL, become a third party we invited onto a stranger's browser.
 */
export const SITE_FONTS = {
  sans: { label: "Sans", hint: "Outfit — the app's own." },
  display: { label: "Display", hint: "Lilita One. Loud and short." },
  serif: { label: "Serif", hint: "Instrument Serif. Editorial." },
  rounded: { label: "Rounded", hint: "Nunito. Friendly." },
  mono: { label: "Mono", hint: "Geist Mono. Technical." },
} as const;

export type SiteFont = keyof typeof SITE_FONTS;
export const DEFAULT_FONT: SiteFont = "sans";

/**
 * Six hex digits, and nothing else in the whole universe of CSS colours.
 *
 * NOT because a colour is dangerous — because a STRING is. `--sk-accent` is
 * read by `background: var(--sk-accent)`, so whatever is stored lands inside a
 * declaration. Accepting `red` would mean also accepting `red;` and
 * `url(https://tracker/?v=)` and every other token sequence a custom property
 * considers valid, and then arguing about which of them can leak a viewer's IP
 * to a third party the page owner chose. `#rrggbb` cannot be any of those.
 *
 * The cost is real and small: no `rgb()`, no alpha, no named colours. Every one
 * of those is expressible as six hex digits by the picker before it saves.
 */
const HEX = /^#[0-9a-f]{6}$/;

export function parseAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return HEX.test(normalised) ? normalised : null;
}

function channel(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/**
 * The text colour to put ON an accent — black or white, whichever wins.
 *
 * THIS IS WHY A COLOUR PICKER IS SAFE TO OFFER AT ALL. The danger with "pick
 * any colour" was never injection, it is a pale yellow button with white text
 * on it that its owner cannot see is unreadable because their screen is bright
 * and they already know what it says. So the owner chooses the fill and we
 * choose the text, every time.
 *
 * The guarantee is arithmetic, not a heuristic: contrast against black rises as
 * contrast against white falls, and they cross where L = 0.179 — at which point
 * both are 4.58:1. So `max(black, white)` is never below 4.58:1 for ANY colour
 * in the sRGB cube, and AA holds for every accent anyone can pick. Asserted
 * over the full cube in theme.test.ts.
 */
export function onAccent(hex: string): "#000000" | "#ffffff" {
  const l = luminance(hex);
  const onBlack = (l + 0.05) / 0.05;
  const onWhite = 1.05 / (l + 0.05);
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}

/**
 * Corner and spacing, as MULTIPLIERS on the skin rather than absolute values.
 *
 * That distinction is the whole design. An absolute radius would let someone
 * set clay to 0px and skeu to 40px, at which point the six skins stop being six
 * languages and become one language with a lot of knobs. A multiplier keeps the
 * skin's proportions and moves them together — a "sharper" clay is still clay.
 */
export const SITE_RADII = {
  sharp: { label: "Sharp", scale: 0.25 },
  normal: { label: "Normal", scale: 1 },
  round: { label: "Round", scale: 1.6 },
} as const;

export const SITE_DENSITIES = {
  tight: { label: "Tight", scale: 0.6 },
  normal: { label: "Normal", scale: 1 },
  roomy: { label: "Roomy", scale: 1.5 },
} as const;

export type SiteRadius = keyof typeof SITE_RADII;
export type SiteDensity = keyof typeof SITE_DENSITIES;
export const DEFAULT_RADIUS: SiteRadius = "normal";
export const DEFAULT_DENSITY: SiteDensity = "normal";

export type SiteTheme = {
  skin: SiteSkin;
  font: SiteFont;
  /** `null` means "whatever the skin says", which is the common case. */
  accent: string | null;
  radius: SiteRadius;
  density: SiteDensity;
};

export const DEFAULT_THEME: SiteTheme = {
  skin: DEFAULT_SKIN,
  font: DEFAULT_FONT,
  accent: null,
  radius: DEFAULT_RADIUS,
  density: DEFAULT_DENSITY,
};

/**
 * Never returns null.
 *
 * Unlike block content — where an unparseable block is one gap on an otherwise
 * fine page — there is no such thing as a page with no appearance. A corrupt or
 * unknown value falls back to the default rather than rendering an unstyled
 * page, so a row written by a newer deploy, or by hand through PostgREST,
 * degrades to "looks like the default" instead of "looks broken".
 */
export function parseTheme(value: unknown): SiteTheme {
  if (typeof value !== "object" || value === null) return DEFAULT_THEME;
  const raw = value as Record<string, unknown>;

  return {
    skin:
      typeof raw.skin === "string" && raw.skin in SITE_SKINS
        ? (raw.skin as SiteSkin)
        : DEFAULT_SKIN,
    font:
      typeof raw.font === "string" && raw.font in SITE_FONTS
        ? (raw.font as SiteFont)
        : DEFAULT_FONT,
    accent: parseAccent(raw.accent),
    radius:
      typeof raw.radius === "string" && raw.radius in SITE_RADII
        ? (raw.radius as SiteRadius)
        : DEFAULT_RADIUS,
    density:
      typeof raw.density === "string" && raw.density in SITE_DENSITIES
        ? (raw.density as SiteDensity)
        : DEFAULT_DENSITY,
  };
}

export function isSiteSkin(value: unknown): value is SiteSkin {
  return typeof value === "string" && value in SITE_SKINS;
}

export function isSiteFont(value: unknown): value is SiteFont {
  return typeof value === "string" && value in SITE_FONTS;
}

export function isSiteRadius(value: unknown): value is SiteRadius {
  return typeof value === "string" && value in SITE_RADII;
}

export function isSiteDensity(value: unknown): value is SiteDensity {
  return typeof value === "string" && value in SITE_DENSITIES;
}

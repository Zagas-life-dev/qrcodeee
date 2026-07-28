/**
 * QR styling (§6). `profiles.qr_style` is a free-form jsonb column capped only
 * by size, so nothing in the database guarantees its shape — everything that
 * reads it must treat it as untrusted and normalise first.
 */

export const DOT_STYLES = [
  "square", "dots", "rounded", "extra-rounded", "classy", "classy-rounded",
] as const;
export const CORNER_STYLES = ["square", "dot", "extra-rounded"] as const;

export type DotStyle = (typeof DOT_STYLES)[number];
export type CornerStyle = (typeof CORNER_STYLES)[number];

export type QrStyle = {
  dotColor: string;
  backgroundColor: string;
  dotStyle: DotStyle;
  cornerStyle: CornerStyle;
  logoUrl: string | null;
};

/**
 * §6: "Keep a safe default style in reserve. If a user's saved custom style ever
 * fails validation later (e.g. after a rendering change), fall back to the safe
 * default automatically rather than rendering a broken code."
 *
 * Plain square dots, maximum contrast, no logo — the most scannable thing a QR
 * code can be. This is the floor the app can always drop back to.
 */
export const SAFE_DEFAULT_STYLE: QrStyle = {
  dotColor: "#111111",
  backgroundColor: "#ffffff",
  dotStyle: "square",
  cornerStyle: "square",
  logoUrl: null,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Only our own Cloudinary cloud, matching the photo_url constraint in §3. */
const ALLOWED_LOGO = /^https:\/\/res\.cloudinary\.com\/djm0gwdv\/image\/upload\//;

/**
 * Coerces whatever is in `qr_style` into a renderable style, field by field.
 *
 * Per-field fallback rather than all-or-nothing: one unrecognised value (a dot
 * style removed in a library upgrade, say) shouldn't discard the user's colours
 * along with it.
 */
export function normalizeQrStyle(raw: unknown): QrStyle {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const colour = (value: unknown, fallback: string) =>
    typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;

  const logo = input.logoUrl;

  return {
    dotColor: colour(input.dotColor, SAFE_DEFAULT_STYLE.dotColor),
    backgroundColor: colour(input.backgroundColor, SAFE_DEFAULT_STYLE.backgroundColor),
    dotStyle: DOT_STYLES.includes(input.dotStyle as DotStyle)
      ? (input.dotStyle as DotStyle)
      : SAFE_DEFAULT_STYLE.dotStyle,
    cornerStyle: CORNER_STYLES.includes(input.cornerStyle as CornerStyle)
      ? (input.cornerStyle as CornerStyle)
      : SAFE_DEFAULT_STYLE.cornerStyle,
    logoUrl: typeof logo === "string" && ALLOWED_LOGO.test(logo) ? logo : null,
  };
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Fast pre-check before the real scan test.
 *
 * This is a warning, not a gate — §6 is explicit that even a code which decodes
 * perfectly on a laptop can fail printed, in low light, at a distance, or behind
 * screen glare. The decode test is the gate; this just catches the obvious cases
 * instantly while someone is dragging a colour picker.
 */
export function hasUsableContrast(style: QrStyle): boolean {
  return contrastRatio(style.dotColor, style.backgroundColor) >= 4;
}

/**
 * §6: high error correction whenever a logo is embedded, because the logo
 * physically covers modules that the decoder then has to reconstruct.
 */
export function errorCorrectionFor(style: QrStyle): "M" | "H" {
  return style.logoUrl ? "H" : "M";
}

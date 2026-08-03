/**
 * Per-block presentation (site-spec S7).
 *
 * THE RULE THAT MAKES CUSTOMISATION SAFE IS "BOUNDED VALUE", NOT "CLOSED SET".
 * The skin is an id because a skin is a whole stylesheet and there is no way to
 * validate one. These are different: an alignment is one of three words, a
 * scale is a number in a range, a colour is six hex digits. Every one of them
 * can be checked completely, so every one of them can be free.
 *
 * What stays forbidden is the same thing that was always forbidden — a string
 * that reaches CSS unparsed. Nothing below is interpolated into a stylesheet:
 * alignments and tones become data attributes, the scale becomes a numeric
 * custom property, and a colour becomes `#rrggbb` or nothing at all.
 */

import { parseAccent } from "./theme";

export const BLOCK_ALIGNS = ["start", "center", "end"] as const;
export type BlockAlign = (typeof BLOCK_ALIGNS)[number];

/**
 * How much chrome the block carries.
 *
 * `plain` is the one that earns its place: a heading or a caption sitting in
 * its own bordered, shadowed card is the single thing that makes a built page
 * look built rather than designed. Being able to drop the box is most of what
 * "scale things differently" means in practice.
 */
export const BLOCK_TONES = ["surface", "accent", "plain"] as const;
export type BlockTone = (typeof BLOCK_TONES)[number];

/**
 * Text scale, as a multiplier on the block's root font size.
 *
 * Bounded rather than free: below ~0.8 body text stops being legible on a
 * phone, and above ~1.75 a block in a quarter-width bento cell overflows its
 * pane no matter what else is set. Both ends are places where the page stops
 * working, so they are the range rather than a suggestion.
 */
export const MIN_BLOCK_SCALE = 0.8;
export const MAX_BLOCK_SCALE = 1.75;
export const DEFAULT_BLOCK_SCALE = 1;

export type BlockStyle = {
  align: BlockAlign;
  tone: BlockTone;
  scale: number;
  /**
   * This block's own accent, overriding the page's.
   *
   * `null` means "use the page accent", which is the common case and the one
   * that keeps a page coherent — per-block colour exists for the one tile you
   * want to shout, not so every block can be a different hue. Validated by the
   * same `parseAccent` the page uses, and its foreground is derived the same
   * way, so a per-block colour is exactly as safe and exactly as readable.
   */
  accent: string | null;
};

export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  align: "start",
  tone: "surface",
  scale: DEFAULT_BLOCK_SCALE,
  accent: null,
};

export function clampBlockScale(value: unknown): number {
  const scale = Number(value);
  // `Number(null)` is 0 and `Number([])` is 0, and 0 would clamp to the minimum
  // rather than to the default — a block with no scale set would silently come
  // back at 0.8. Narrow the type first, as `parseStats` does.
  if (typeof value !== "number" && typeof value !== "string") return DEFAULT_BLOCK_SCALE;
  if (!Number.isFinite(scale)) return DEFAULT_BLOCK_SCALE;
  const bounded = Math.min(Math.max(scale, MIN_BLOCK_SCALE), MAX_BLOCK_SCALE);
  // Two decimals: this becomes a CSS custom property, and a 17-digit float
  // there is noise in every serialised page for no visible difference.
  return Math.round(bounded * 100) / 100;
}

/**
 * Never returns null — same reasoning as `parseTheme`. A block with a corrupt
 * style is a block that looks default, never a block that fails to render.
 */
export function parseBlockStyle(value: unknown): BlockStyle {
  if (typeof value !== "object" || value === null) return DEFAULT_BLOCK_STYLE;
  const raw = value as Record<string, unknown>;

  return {
    align: (BLOCK_ALIGNS as readonly string[]).includes(raw.align as string)
      ? (raw.align as BlockAlign)
      : DEFAULT_BLOCK_STYLE.align,
    tone: (BLOCK_TONES as readonly string[]).includes(raw.tone as string)
      ? (raw.tone as BlockTone)
      : DEFAULT_BLOCK_STYLE.tone,
    scale: clampBlockScale(raw.scale),
    accent: parseAccent(raw.accent),
  };
}

export function isBlockAlign(value: unknown): value is BlockAlign {
  return typeof value === "string" && (BLOCK_ALIGNS as readonly string[]).includes(value);
}

export function isBlockTone(value: unknown): value is BlockTone {
  return typeof value === "string" && (BLOCK_TONES as readonly string[]).includes(value);
}

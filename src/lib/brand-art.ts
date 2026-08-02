/**
 * The Skan QR mark, as geometry.
 *
 * This module is the single source of truth for the logo, and it is deliberately
 * dependency-free plain data so BOTH consumers can read it: `components/brand.tsx`
 * imports it to render the mark in the app, and `scripts/generate-icons.mjs`
 * imports it (via Node's type stripping) to rasterise the PWA icons. Before this
 * the icon PNGs were opaque binaries with no relationship to the on-screen logo,
 * which is how an app ends up shipping two subtly different marks.
 *
 * ── The design, and why it is this ────────────────────────────────────────────
 *
 * docs/newdesignlang's logo sheet lays out the strategy on a worked example
 * (Nuvia): take ONE letterform, give it a single geometric idea, draw it as an
 * outline rather than a solid — a thick ink contour with a paper-coloured
 * interior, which is exactly how the display face's letters are built — and set
 * it on a lilac squircle for the app icon. Not an illustration. Not a scene.
 *
 * So: the letter S, and the one idea is that it sits inside a scanner's
 * viewfinder brackets. That pairing is the whole mark. The S names the app, the
 * brackets say what it does, and they are the most legible shorthand for "point
 * a camera at this" that exists — which matters for a product whose primary verb
 * is scanning.
 *
 * The S itself is drawn as a STROKE, not a filled glyph, so the outlined look
 * comes from painting the same path twice: a 17-unit ink pass, then a 9.5-unit
 * paper pass over it. That leaves a ~3.75-unit contour on each side at every
 * point along the curve, which a filled-glyph-plus-outline approach cannot
 * promise (an outline on a fill is centred on the contour, so it eats half its
 * width into the letter and closes the counters on a face this heavy).
 *
 * ── Sizes this was checked at ─────────────────────────────────────────────────
 *
 * Rendered and inspected at 32, 40, 64 and 192px. The brackets are the first
 * thing to go soft at 32px, which is why they are a separate, lighter weight
 * than the letter rather than matching it — at favicon size the S carries the
 * mark and the brackets read as a frame, which is the correct order of
 * priority.
 */

/** Everything below is authored in this coordinate space. */
export const MARK_SIZE = 80;
export const MARK_VIEWBOX = `0 0 ${MARK_SIZE} ${MARK_SIZE}`;

/**
 * The viewfinder brackets: four corner Ls with a 12-unit radius on the turn.
 *
 * Drawn on a 6.5/73.5 box which, with the 5-unit stroke centred on it, puts the
 * outer edge at 4 — a 5% margin inside the viewBox, so the mark never collides
 * with whatever contains it.
 */
export const BRACKET_PATHS = [
  "M6.5 26 V18.5 A12 12 0 0 1 18.5 6.5 H26",
  "M54 6.5 H61.5 A12 12 0 0 1 73.5 18.5 V26",
  "M73.5 54 V61.5 A12 12 0 0 1 61.5 73.5 H54",
  "M26 73.5 H18.5 A12 12 0 0 1 6.5 61.5 V54",
];

export const BRACKET_STROKE = 5;

/**
 * The S centreline. Condensed and slightly top-heavy, matching the display face:
 * the upper bowl is tighter than the lower one, which is what stops a heavy S
 * from reading as an 8.
 */
export const S_PATH =
  "M43 19 C43 11 21 10 21 21 C21 29 43 33 43 42 C43 54 21 53 21 44";

/** Ink pass, then paper pass. The difference is the contour. */
export const S_STROKE_INK = 17;
export const S_STROKE_PAPER = 9.5;

/**
 * Centres the S's own bounding box on the viewBox centre.
 *
 * The centreline spans x 21→43 and y 10→53, so its centre is (32, 31.5); at
 * scale 0.86 that lands at (27.52, 27.09) and needs (12.48, 12.91) of offset to
 * reach (40, 40). Recompute both numbers together if the scale ever changes —
 * they are not independent.
 */
export const S_TRANSFORM = "translate(12.48 12.91) scale(0.86)";

/** Brand colours, duplicated from globals.css because the icon script rasterises
    outside any stylesheet and cannot read a CSS custom property. */
export const BRAND = {
  ink: "#0b0b0b",
  paper: "#fffdf7",
  lilac: "#bca6f7",
  canvas: "#ffe27f",
};

/**
 * The mark as standalone SVG markup, for the icon rasteriser.
 *
 * `tile` draws the lilac squircle behind it and shrinks the mark to 84% so the
 * brackets clear the rounded corners; `padding` insets the whole composition,
 * which is what a maskable icon needs to survive being cropped to a circle.
 */
export function markSvg({
  size = 512,
  tile = false,
  padding = 0,
  ink = BRAND.ink,
  paper = BRAND.paper,
  tileFill = BRAND.lilac,
  background = "none",
}: {
  size?: number;
  tile?: boolean;
  padding?: number;
  ink?: string;
  paper?: string;
  tileFill?: string;
  background?: string;
} = {}): string {
  const brackets = BRACKET_PATHS.map(
    (d) =>
      `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${BRACKET_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
  ).join("");

  const letter =
    `<g transform="${S_TRANSFORM}">` +
    `<path d="${S_PATH}" fill="none" stroke="${ink}" stroke-width="${S_STROKE_INK}" stroke-linecap="round"/>` +
    `<path d="${S_PATH}" fill="none" stroke="${paper}" stroke-width="${S_STROKE_PAPER}" stroke-linecap="round"/>` +
    `</g>`;

  // Scaling about the centre keeps the mark concentric with the squircle
  // regardless of the factor.
  const mark = tile
    ? `<g transform="translate(40 40) scale(0.84) translate(-40 -40)">${brackets}${letter}</g>`
    : `${brackets}${letter}`;

  const plate = tile
    ? `<rect x="2" y="2" width="76" height="76" rx="22" fill="${tileFill}" stroke="${ink}" stroke-width="4"/>`
    : "";

  const inner = MARK_SIZE - padding * 2;
  const body =
    padding > 0
      ? `<g transform="translate(${padding} ${padding}) scale(${inner / MARK_SIZE})">${plate}${mark}</g>`
      : `${plate}${mark}`;

  const bg =
    background === "none"
      ? ""
      : `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${background}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}">` +
    `${bg}${body}</svg>`
  );
}

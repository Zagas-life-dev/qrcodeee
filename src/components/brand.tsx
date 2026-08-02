import {
  BRACKET_PATHS,
  BRACKET_STROKE,
  MARK_VIEWBOX,
  S_PATH,
  S_STROKE_INK,
  S_STROKE_PAPER,
  S_TRANSFORM,
} from "@/lib/brand-art";

/**
 * The Skan QR logo, on screen. The geometry lives in `lib/brand-art.ts`, which
 * the PWA icon script reads too — see the design notes there.
 */

/**
 * The mark alone.
 *
 * The ink strokes take `currentColor`, so the mark tints with the text colour of
 * whatever contains it and needs no variant for a dark surface. The letter's
 * interior does NOT: it is the paper colour explicitly, because it is the
 * counter of an outlined letterform rather than a fill — on a lilac pill it has
 * to stay white or the S closes up into a blob.
 *
 * That does mean the interior vanishes on a white surface and the S reads as a
 * pure outline. This is the intended behaviour and matches the reference's
 * treatment of outlined type; `paper` is exposed for the rare caller that needs
 * to say otherwise.
 */
export function SkanMark({
  className = "size-7",
  paper = "var(--color-paper)",
}: {
  className?: string;
  paper?: string;
}) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} aria-hidden="true">
      {BRACKET_PATHS.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={BRACKET_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Two passes over one path: the ink pass is the contour, the paper pass
          carves the interior out of it. Order matters. */}
      <g transform={S_TRANSFORM}>
        <path
          d={S_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={S_STROKE_INK}
          strokeLinecap="round"
        />
        <path
          d={S_PATH}
          fill="none"
          stroke={paper}
          strokeWidth={S_STROKE_PAPER}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark, as one lockup.
 *
 * The wordmark is the display face at tight tracking — the reference sets its
 * logotype in the text face, but this app's display face IS the reference's
 * logotype face, so using it here is the closer read. "QR" is not given its own
 * treatment on purpose: a two-tone wordmark at 14px turns into visual noise, and
 * the mark is already carrying the QR half of the idea.
 */
export function SkanLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SkanMark className="size-7 shrink-0" />
      <span className="font-display text-base leading-none tracking-tight">Skan QR</span>
    </span>
  );
}

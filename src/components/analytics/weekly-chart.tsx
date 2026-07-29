"use client";

import { useState } from "react";

type Point = { label: string; value: number; full: string };

type Props = {
  /** Names the single series — so no legend box is needed. */
  title: string;
  points: Point[];
  /** "connection" / "scan" — pluralised for the tooltip and the a11y table. */
  unit: string;
  hue: "blue" | "orange";
};

/**
 * Twelve weeks of one measure, as columns.
 *
 * ONE SERIES PER CHART, DELIBERATELY. Connections and scans are different
 * measures on different scales, and putting them on one plot would mean two
 * y-axes — the single most misleading thing a chart can do, since the crossover
 * point is then an artefact of two arbitrary scales. Two charts side by side let
 * the reader compare shape without inviting a false reading of magnitude.
 *
 * Bars rather than a line: the weeks are discrete buckets, not a continuous
 * signal, and a zero week is a real zero rather than a dip between samples.
 *
 * Colors are the validated series steps for this app's actual surfaces
 * (#ffffff / #0a0a0a), not the reference palette's — contrast is only meaningful
 * against the surface a chart really renders on. Both clear 3:1 in both modes.
 * The dark steps are chosen for the dark surface, never an automatic flip of the
 * light ones. There is no theme toggle in this app, so the media query is the
 * whole story; add a [data-theme] scope here if one is ever introduced.
 */
export function WeeklyChart({ title, points, unit, hue }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((p) => p.value), 1);
  const total = points.reduce((sum, p) => sum + p.value, 0);

  return (
    <figure className="m-0 rounded-lg border border-current/10 p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs opacity-50 tabular-nums">
          {total} in 12 weeks
        </span>
      </figcaption>

      {/* Each column is focusable and carries its own label, so this plot IS its
          own table view: every value is reachable in order by keyboard and by a
          screen reader, with the week and the count spoken together. That is
          also why there is no aria-hidden here and no duplicate sr-only table —
          a focusable element inside an aria-hidden subtree is a defect, and a
          second copy of the same twelve numbers only makes a screen reader read
          the series twice. */}
      <div className="relative mt-4">
        <ul
          className="flex h-32 list-none items-end gap-[2px] p-0"
          onMouseLeave={() => setActive(null)}
        >
          {points.map((point, index) => {
            const isActive = active === index;
            return (
              <li
                key={point.full}
                tabIndex={0}
                aria-label={`Week of ${point.full}: ${point.value} ${point.value === 1 ? unit : `${unit}s`}`}
                // The hit target is the whole column, not the bar: a 2px zero
                // week would otherwise be unhoverable, and at twelve columns in
                // a half-width card each one clears the ~24px minimum.
                className="relative flex h-full flex-1 items-end rounded-sm outline-offset-2 focus-visible:outline-2"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <div
                  aria-hidden
                  className="w-full rounded-t transition-[height,opacity]"
                  style={{
                    // A zero week still draws a 2px stub anchored to the
                    // baseline, so an empty week reads as "nothing happened"
                    // rather than as missing data.
                    height: point.value === 0 ? "2px" : `${(point.value / max) * 100}%`,
                    background:
                      point.value === 0
                        ? "var(--chart-empty)"
                        : hue === "blue"
                          ? "var(--chart-blue)"
                          : "var(--chart-orange)",
                    opacity: active === null || isActive ? 1 : 0.45,
                  }}
                />
              </li>
            );
          })}
        </ul>

        {/* Baseline, recessive. */}
        <div aria-hidden className="h-px w-full bg-current/15" />

        <div aria-hidden className="mt-1.5 flex justify-between text-[10px] opacity-45">
          <span>{points[0]?.label}</span>
          <span>{points.at(-1)?.label}</span>
        </div>

        {active !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-current/15 bg-[var(--background)] px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          >
            <span className="font-medium tabular-nums">{points[active].value}</span>{" "}
            <span className="opacity-70">
              {points[active].value === 1 ? unit : `${unit}s`} · {points[active].full}
            </span>
          </div>
        ) : null}
      </div>

    </figure>
  );
}

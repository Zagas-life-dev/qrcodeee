import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { NetworkingStats } from "@/lib/supabase/database.types";
import { WeeklyChart } from "@/components/analytics/weekly-chart";

export const metadata = { title: "Analytics · QR Connect" };

/**
 * Networking analytics (§9).
 *
 * Every number here answers a question someone would actually act on — how fast
 * is my network growing, is my code getting used, whose details have I not
 * captured, whose have gone stale. Vanity totals with no next step were left
 * out; so was anything derived from who saved the VIEWER's card, which
 * contact_saves deliberately makes unreadable (see networking_stats).
 */
export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/analytics");

  const { data, error } = await supabase.rpc("networking_stats");
  const stats = data as NetworkingStats | null;

  if (error || !stats) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="font-display text-3xl leading-none tracking-tight">Analytics</h1>
        <p className="mt-4 rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-bold shadow-brutal">
          We couldn&apos;t load your stats.
        </p>
      </main>
    );
  }

  const weeks = stats.weeks.map((week) => ({
    label: shortDate(week.week_start),
    full: longDate(week.week_start),
    connections: week.connections,
    scans: week.scans,
  }));

  const delta = stats.new_30d - stats.new_prev_30d;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl leading-none tracking-tight">Analytics</h1>
        {stats.first_connection_at ? (
          <span className="rounded-full border-2 border-ink bg-paper px-2.5 py-0.5 text-xs font-bold">
            Since {longDate(stats.first_connection_at)}
          </span>
        ) : null}
      </div>

      {stats.active === 0 && stats.scans_total === 0 ? (
        <div className="mt-8 rounded-brutal border-2 border-dashed border-ink px-4 py-10 text-center">
          <p className="text-sm font-bold">
            Nothing to measure yet. Once people start scanning your code, your
            growth and reach show up here.
          </p>
          <Link
            href="/qr"
            className="mt-4 inline-flex rounded-brutal border-2 border-ink bg-lemon px-4 py-2 text-sm font-bold shadow-brutal nb-press"
          >
            Show your code
          </Link>
        </div>
      ) : (
        <>
          {/* Hero figure + KPI row. A single current value is a stat tile, never
              a one-bar chart. */}
          <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              value={stats.active}
              label={stats.active === 1 ? "Connection" : "Connections"}
              hero
            />
            <Stat
              value={stats.new_30d}
              label="New, last 30 days"
              delta={
                stats.new_prev_30d === 0 && stats.new_30d === 0
                  ? null
                  : `${delta >= 0 ? "+" : ""}${delta} vs previous 30`
              }
            />
            <Stat value={stats.scans_30d} label="Scans, last 30 days" />
            <Stat value={stats.scans_total} label="Scans, all time" />
          </section>

          <section className="mt-4 grid gap-3 sm:grid-cols-2">
            <WeeklyChart
              title="New connections"
              unit="connection"
              hue="blue"
              points={weeks.map((w) => ({
                label: w.label,
                full: w.full,
                value: w.connections,
              }))}
            />
            <WeeklyChart
              title="Code scans"
              unit="scan"
              hue="orange"
              points={weeks.map((w) => ({
                label: w.label,
                full: w.full,
                value: w.scans,
              }))}
            />
          </section>

          {/* The part with a next step attached. */}
          <section className="mt-10">
            <h2 className="font-display text-xl leading-none tracking-tight">
              Worth doing something about
            </h2>
            <ul className="mt-4 space-y-3">
              <Action
                count={stats.unsaved}
                singular="connection whose contact you haven't saved"
                plural="connections whose contacts you haven't saved"
                empty="You've saved every connection's contact."
                href="/connections"
                cta="Save them"
              />
              <Action
                count={stats.stale}
                singular="saved card that's now out of date"
                plural="saved cards that are now out of date"
                empty="Every card you've saved is current."
                href="/connections"
                cta="Refresh"
              />
            </ul>
          </section>

          <p className="mt-8 text-xs font-medium text-ink/70">
            Scan counts come from your own QR codes, which expire every 15
            minutes — a scan is counted when someone opens one, whether or not it
            became a new connection. We don&apos;t track who saved your card:
            that&apos;s private to them.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({
  value,
  label,
  delta,
  hero,
}: {
  value: number;
  label: string;
  delta?: string | null;
  hero?: boolean;
}) {
  return (
    // The hero takes the lemon fill so the headline figure leads the row. The
    // fill marks WHICH TILE is the headline, it never encodes the value — no
    // tile's colour changes with its number.
    <div
      className={`rounded-brutal border-2 border-ink p-4 shadow-brutal ${
        hero ? "bg-lemon" : "bg-paper"
      }`}
    >
      {/* Body sans, not font-display, and no tabular-nums: a display face on a
          figure reads as decoration, and equal-width digits make a standalone
          number look loose at this size. Neither is a house-style quibble —
          both are on the dataviz skill's anti-pattern list. */}
      <p
        className={
          hero
            ? "text-4xl font-bold tracking-tight"
            : "text-2xl font-bold tracking-tight"
        }
      >
        {value}
      </p>
      <p className="mt-1.5 font-display text-xs tracking-wide uppercase">{label}</p>
      {delta ? (
        // Deliberately NOT colored. The sign is already in the string ("+3 vs
        // previous 30"), so direction is carried by text; tinting it red would
        // also mean scoring a quiet month as a failure, which is not what a
        // networking app should tell someone.
        <p className="mt-1 text-xs font-medium">{delta}</p>
      ) : null}
    </div>
  );
}

function Action({
  count,
  singular,
  plural,
  empty,
  href,
  cta,
}: {
  count: number;
  singular: string;
  plural: string;
  empty: string;
  href: string;
  cta: string;
}) {
  // A cleared item keeps its card but drops to the lime fill and loses the
  // button — the row still reads as "checked", rather than vanishing and
  // leaving the reader unsure whether it was ever there.
  if (count === 0) {
    return (
      <li className="flex items-center gap-3 rounded-brutal border-2 border-ink bg-lime p-3 shadow-brutal">
        <span className="text-sm font-bold">{empty}</span>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-brutal border-2 border-ink bg-paper p-3 shadow-brutal">
      <span className="min-w-0 flex-1 text-sm font-medium">
        <span className="font-bold">{count}</span>{" "}
        {count === 1 ? singular : plural}
      </span>
      <Link
        href={href}
        className="flex min-h-11 shrink-0 items-center rounded-brutal border-2 border-ink bg-lemon px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm"
      >
        {cta}
      </Link>
    </li>
  );
}

/** Week-axis ticks: only the first and last are drawn, so these stay short. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

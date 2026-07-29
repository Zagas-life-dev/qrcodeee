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
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-3 text-sm opacity-70">We couldn&apos;t load your stats.</p>
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        {stats.first_connection_at ? (
          <span className="text-xs opacity-50">
            Since {longDate(stats.first_connection_at)}
          </span>
        ) : null}
      </div>

      {stats.active === 0 && stats.scans_total === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-current/20 px-4 py-10 text-center">
          <p className="text-sm opacity-70">
            Nothing to measure yet. Once people start scanning your code, your
            growth and reach show up here.
          </p>
          <Link
            href="/qr"
            className="mt-4 inline-flex rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
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
          <section className="mt-8">
            <h2 className="text-sm font-medium">Worth doing something about</h2>
            <ul className="mt-3 divide-y divide-current/10">
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

          <p className="mt-8 text-xs opacity-45">
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
    <div className="rounded-lg border border-current/10 p-4">
      <p
        className={
          hero
            ? "text-4xl font-semibold tracking-tight"
            : "text-2xl font-semibold tracking-tight"
        }
      >
        {value}
      </p>
      <p className="mt-1 text-xs opacity-60">{label}</p>
      {delta ? (
        // Deliberately NOT colored. The sign is already in the string ("+3 vs
        // previous 30"), so direction is carried by text; tinting it red would
        // also mean scoring a quiet month as a failure, which is not what a
        // networking app should tell someone.
        <p className="mt-1 text-xs opacity-70">{delta}</p>
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
  if (count === 0) {
    return (
      <li className="flex items-center gap-3 py-3">
        <span className="text-sm opacity-60">{empty}</span>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium tabular-nums">{count}</span>{" "}
        {count === 1 ? singular : plural}
      </span>
      <Link
        href={href}
        className="shrink-0 rounded-md border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5"
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

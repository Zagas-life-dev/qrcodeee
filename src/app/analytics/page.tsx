import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { NetworkingStats } from "@/lib/supabase/database.types";
import { WeeklyChart } from "@/components/analytics/weekly-chart";
import {
  ActionLink,
  Columns,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  Pill,
} from "@/components/page";

export const metadata = { title: "Analytics · Skan QR" };

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
      <Page width="xl">
        <PageHeader title="Analytics" />
        <Notice tone="error" className="mt-6">
          We couldn&apos;t load your stats.
        </Notice>
      </Page>
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
    <Page width="wide">
      <PageHeader
        title="Analytics"
        actions={
          stats.first_connection_at ? (
            <Pill>Since {longDate(stats.first_connection_at)}</Pill>
          ) : undefined
        }
      />

      {stats.active === 0 && stats.scans_total === 0 ? (
        <div className="mt-8 max-w-2xl">
          <EmptyState
            action={
              <ActionLink href="/qr" tone="primary" size="lg">
                Show your code
              </ActionLink>
            }
          >
            Nothing to measure yet. Once people start scanning your code, your
            growth and reach show up here.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Hero figure + KPI row. A single current value is a stat tile, never
              a one-bar chart. */}
          {/* The KPI row spans the full width above both columns — it is the
              summary the rest of the page elaborates on, so it should not sit
              inside one of them. */}
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

          {/* The measures fill the width; the things to DO about them ride
              alongside on a display wide enough, instead of waiting two screens
              below the charts. */}
          <Columns
            className="mt-4"
            aside={
              <>
                <div className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
                  <h2 className="font-display text-base">Worth doing something about</h2>
                  <ul className="mt-3 space-y-3">
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
                </div>

                <p className="text-xs font-medium text-ink/70">
                  Scan counts come from your own QR codes, which expire every 15
                  minutes — a scan is counted when someone opens one, whether or
                  not it became a new connection. We don&apos;t track who saved
                  your card: that&apos;s private to them.
                </p>
              </>
            }
          >
            {/* Side by side only once the main column can give each chart its
                own readable width — inside a two-column page that is 2xl, not
                xl. A 12-week bar chart at 300px is a sparkline with axis
                labels. */}
            <div className="grid gap-3 2xl:grid-cols-2">
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
            </div>
          </Columns>
        </>
      )}
    </Page>
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
    // The hero takes the lilac fill so the headline figure leads the row. The
    // fill marks WHICH TILE is the headline, it never encodes the value — no
    // tile's colour changes with its number.
    <div
      className={`rounded-brutal border-2 border-ink p-4 shadow-brutal ${
        hero ? "bg-lilac" : "bg-paper"
      }`}
    >
      {/* Body sans, not font-display, and no tabular-nums: a display face on a
          figure reads as decoration, and equal-width digits make a standalone
          number look loose at this size. Neither is a house-style quibble —
          both are on the dataviz skill's anti-pattern list. */}
      <p
        className={
          hero
            ? "text-4xl font-semibold tracking-tight"
            : "text-2xl font-semibold tracking-tight"
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
      <li className="rounded-brutal border-2 border-ink bg-lime p-3 shadow-brutal">
        <span className="text-sm font-semibold">{empty}</span>
      </li>
    );
  }

  // Wraps rather than squeezing: these rows live in a 19rem rail on desktop and
  // full width on a phone, and the sentence must not be truncated to keep the
  // button on the same line.
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-brutal border-2 border-ink bg-paper p-3 shadow-brutal">
      <span className="min-w-40 flex-1 text-sm font-medium">
        <span className="font-semibold">{count}</span>{" "}
        {count === 1 ? singular : plural}
      </span>
      <ActionLink href={href} tone="primary" size="sm" className="shrink-0">
        {cta}
      </ActionLink>
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

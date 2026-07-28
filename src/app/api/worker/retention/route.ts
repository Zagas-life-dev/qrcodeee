import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { shouldRun } from "@/lib/notifications/schedule";

/**
 * §8 retention prune. Intended to run daily on a cron.
 *
 * Loops until the SQL reports no backlog, because each call deletes at most one
 * batch — an unbounded delete on the highest-write table in the system is a
 * long-running lock-holding transaction, which is the shape §5.4 batches
 * everything else to avoid.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROUNDS = 20;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function handle(request: NextRequest) {
  const expected = process.env.WORKER_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Worker is not configured." }, { status: 503 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const header = request.headers.get("x-worker-secret");
  if (!secretMatches(bearer, expected) && !secretMatches(header, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Retention honours the same switch. `off` pauses it; `weekly` prunes one day
  // a week, which is fine because every window here is measured in days.
  const decision = shouldRun({ force: request.nextUrl.searchParams.get("force") === "1" });
  if (!decision.run) {
    return NextResponse.json({ ok: true, skipped: true, ...decision });
  }

  const admin = createAdminClient();
  const totals = { change_events: 0, notifications: 0, rate_events: 0 };
  let rounds = 0;

  try {
    for (; rounds < MAX_ROUNDS; rounds += 1) {
      const { data, error } = await admin.rpc("run_retention", { p_batch: 5000 });
      if (error) throw new Error(error.message);

      const result = data as unknown as {
        change_events: number;
        notifications: number;
        rate_events: number;
        more: boolean;
      };
      totals.change_events += result.change_events;
      totals.notifications += result.notifications;
      totals.rate_events += result.rate_events;

      if (!result.more) break;
    }

    // Hitting the ceiling means a backlog remains — reported rather than
    // swallowed, because a job that silently never catches up looks identical to
    // one with nothing to do.
    return NextResponse.json({
      ok: true,
      rounds,
      backlogRemaining: rounds >= MAX_ROUNDS,
      ...totals,
    });
  } catch (cause) {
    console.error("retention run failed", cause);
    return NextResponse.json({ error: "Retention run failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

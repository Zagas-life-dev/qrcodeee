import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Health and queue depth (§9).
 *
 * Two response shapes on purpose:
 *
 *   unauthenticated -> {ok, db} only. Uptime monitors typically can't send
 *                      custom headers, and liveness is not sensitive.
 *   with the worker secret -> queue depths and counts, which ARE sensitive:
 *                      total user count is business data, and a public backlog
 *                      figure tells an attacker exactly when the notification
 *                      worker is struggling.
 *
 * `pendingEvents` is the number §9 wants an alert on — "notification queue
 * backlog". A steadily climbing value means the worker is not keeping up, or is
 * not running at all, and the symptom users see is simply that nobody is told
 * anything.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient();

  // Liveness: a trivial query that still proves the connection and RLS bypass
  // both work.
  const started = Date.now();
  const { error: pingError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .limit(1);
  const dbMs = Date.now() - started;

  if (pingError) {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }

  const expected = process.env.WORKER_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const header = request.headers.get("x-worker-secret");
  const authorised =
    Boolean(expected) &&
    (secretMatches(bearer, expected!) || secretMatches(header, expected!));

  if (!authorised) {
    return NextResponse.json({ ok: true, db: "up" });
  }

  const [pending, oldestPending, unread, staleRate] = await Promise.all([
    admin
      .from("profile_change_events")
      .select("id", { count: "exact", head: true })
      .is("processed_at", null),
    admin
      .from("profile_change_events")
      .select("created_at")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    admin
      .from("rate_events")
      .select("id", { count: "exact", head: true })
      .lt("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  const oldest = oldestPending.data?.created_at;

  return NextResponse.json({
    ok: true,
    db: "up",
    dbMs,
    // The alert condition from §9.
    pendingEvents: pending.count ?? 0,
    // More diagnostic than the count: a backlog of 5 that is two hours old means
    // the worker is not running, which a small count alone would hide.
    oldestPendingAgeSeconds: oldest
      ? Math.round((Date.now() - new Date(oldest).getTime()) / 1000)
      : 0,
    unreadNotifications: unread.count ?? 0,
    // Non-zero means the retention cron isn't firing.
    prunableRateEvents: staleRate.count ?? 0,
  });
}

import { NextResponse, type NextRequest } from "next/server";

import { runNotificationWorker } from "@/lib/notifications/worker";
import { log, timed } from "@/lib/observability";
import { shouldRun, timeBudgetMs } from "@/lib/notifications/schedule";

/**
 * Drives the §5.4 fan-out. Intended triggers:
 *   - a Supabase Database Webhook on profile_change_events INSERT (low latency)
 *   - a scheduled cron hit (the safety net, and what catches anything a webhook
 *     dropped — a crashed run leaves events unprocessed by design)
 *
 * Runs on the Node runtime: the worker uses the service-role key and web-push,
 * neither of which belongs on the edge. That used to be pinned with
 * `export const runtime = "nodejs"`, which `cacheComponents` does not permit —
 * nodejs is the default, so the behaviour is unchanged, but nothing may
 * reintroduce an edge runtime for this route.
 */
export const maxDuration = 60;

/**
 * Constant-time comparison. A plain `===` on a secret leaks its length and a
 * little of its content through timing — cheap to avoid on an endpoint that is
 * public by necessity (a webhook has to be able to reach it).
 */
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
    // Fail closed. An unauthenticated worker endpoint is a notification-spam
    // amplifier: it fans out to every connection of every pending profile.
    return NextResponse.json({ error: "Worker is not configured." }, { status: 503 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; Supabase webhooks
  // send whatever custom header you configure. Accept either.
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const header = request.headers.get("x-worker-secret");

  if (!secretMatches(bearer, expected) && !secretMatches(header, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // `?force=1` (or any Database Webhook, which sets it) bypasses the weekly
  // gate: a webhook only fires because an event was just written, so there is
  // genuinely something to deliver. WORKER_MODE=off still wins.
  const force = request.nextUrl.searchParams.get("force") === "1";
  const decision = shouldRun({ force });

  if (!decision.run) {
    log.info("worker.notifications.skipped", { mode: decision.mode, reason: decision.reason });
    return NextResponse.json({ ok: true, skipped: true, ...decision });
  }

  try {
    const summary = await timed("worker.notifications", { mode: decision.mode }, () =>
      runNotificationWorker({ budgetMs: timeBudgetMs() }),
    );
    if (!summary.drained) {
      // Ran out of time with profiles still pending. Safe — events stay
      // unprocessed and the next run resumes — but worth surfacing, because on a
      // once-a-day Hobby cron a persistent backlog means a day of silence.
      log.warn("worker.notifications.budget_exhausted", {
        processed: summary.profilesProcessed,
      });
    }
    if (summary.truncated.length > 0) {
      // §5.4 defers the "one profile with 100,000 connections" case deliberately.
      // Seeing this repeatedly is the signal that it has arrived and needs a
      // different notification model, not a bigger loop.
      log.warn("worker.notifications.truncated", {
        profiles: summary.truncated.length,
      });
    }
    return NextResponse.json({ ok: true, mode: decision.mode, ...summary });
  } catch {
    // `timed` already logged the detail. Return a generic body — this endpoint
    // is reachable by anyone who can guess the URL, even though they can't
    // authenticate.
    return NextResponse.json({ error: "Worker run failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

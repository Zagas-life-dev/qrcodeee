import { NextResponse, type NextRequest } from "next/server";

import { runNotificationWorker } from "@/lib/notifications/worker";

/**
 * Drives the §5.4 fan-out. Intended triggers:
 *   - a Supabase Database Webhook on profile_change_events INSERT (low latency)
 *   - a scheduled cron hit (the safety net, and what catches anything a webhook
 *     dropped — a crashed run leaves events unprocessed by design)
 *
 * Runs on the Node runtime: the worker uses the service-role key and web-push,
 * neither of which belongs on the edge.
 */
export const runtime = "nodejs";
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

  try {
    const summary = await runNotificationWorker();
    return NextResponse.json({ ok: true, ...summary });
  } catch (cause) {
    // Log the detail, return a generic body — this endpoint is reachable by
    // anyone who can guess the URL, even though they can't authenticate.
    console.error("notification worker failed", cause);
    return NextResponse.json({ error: "Worker run failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

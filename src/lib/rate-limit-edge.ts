/**
 * Per-IP rate limiting at the edge (§7).
 *
 * Postgres never sees the client IP, so the per-actor limits in `rate_events`
 * cannot cover "one machine hammering the app from many accounts" or anything
 * hitting routes before a session exists. That has to happen further out.
 *
 * ---------------------------------------------------------------------------
 * BE CLEAR ABOUT WHAT THIS IS AND ISN'T.
 *
 * This is an in-memory counter, and §7 explicitly warns that in-memory counters
 * in a Vercel function get limits wrong: state is per-instance, so N warm
 * instances means an attacker gets N times the allowance, and a cold start
 * resets the window entirely. Everything here is a SPEED BUMP against naive
 * scripted traffic, not a security control.
 *
 * The real answer at scale is a WAF rule or Vercel's own IP rate limiting,
 * configured outside the app — see docs/setup.md. This exists because having
 * nothing in front of the scan endpoints is worse, and because it costs no
 * dependency and no external service.
 *
 * The database-backed per-user limits are the ones that actually hold, because
 * they share one source of truth across every instance.
 * ---------------------------------------------------------------------------
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bounded so a flood of unique IPs can't grow this without limit. */
const MAX_TRACKED = 10_000;

export type EdgeLimit = { limit: number; windowMs: number };

export function checkEdgeLimit(key: string, { limit, windowMs }: EdgeLimit): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    // Opportunistic sweep — cheaper than a timer, and only runs when the map has
    // actually grown. Evicting expired entries first means a legitimate burst of
    // new visitors doesn't push out active ones.
    if (buckets.size >= MAX_TRACKED) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
      if (buckets.size >= MAX_TRACKED) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controllable in general, but on Vercel the
 * platform overwrites it — so it is trustworthy THERE and not necessarily
 * anywhere else. Since this whole module is a speed bump rather than a control,
 * a spoofed value costs an attacker a bypass of a limit that was already
 * per-instance. Do not build anything load-bearing on this value.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * qr_token is `gen_random_uuid()::text` (§3, §6), so a valid token is always a
 * canonical v4 UUID. Anchoring on that shape means a scanned code that isn't
 * ours is rejected here rather than becoming a database round trip.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pulls the connect token out of whatever a QR scanner handed us.
 *
 * Accepts any origin, deliberately. A code printed against production is
 * routinely scanned by a build running on localhost or a Vercel preview, and
 * refusing those makes the feature untestable. Accepting them costs nothing:
 * the token is only ever looked up in OUR database, so a QR pointing at
 * `https://evil.example/connect/<uuid>` yields a token that either matches one
 * of our profiles or returns invalid_token. What we must never do is *navigate*
 * to the scanned URL — only ever to our own `/connect/<token>`, which is why
 * this returns a token and not a URL.
 *
 * Returns null for anything that isn't a `/connect/<uuid>` path.
 */
export function parseConnectToken(scanned: string): string | null {
  const text = scanned.trim();
  if (text.length === 0) return null;

  // A bare token, e.g. from a hand-typed code or a non-URL QR payload.
  if (UUID.test(text)) return text.toLowerCase();

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "connect") return null;

  const token = decodeURIComponent(segments[1]);
  return UUID.test(token) ? token.toLowerCase() : null;
}

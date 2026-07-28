/**
 * Placeholder origin. Any value works as long as it can never be a real origin
 * we'd accept — `.invalid` is reserved by RFC 2606 precisely for this.
 */
const SENTINEL_ORIGIN = "https://qr-connect.invalid";

/**
 * Reduces a caller-supplied `next` value to a same-origin path, or falls back.
 *
 * This matters more here than in a typical app: §5.1 requires an unauthenticated
 * scanner's token to survive login, so the post-auth destination is attacker-
 * reachable by construction — anyone can mint a QR code pointing at
 * `/login?next=<anything>`. Without this, that's an open redirect wearing a
 * trusted domain, and the OAuth callback is exactly where a user is least likely
 * to notice they've been bounced somewhere else.
 *
 * Parsing against a sentinel origin rather than pattern-matching on the string
 * is deliberate. The cases that break hand-rolled checks all collapse correctly
 * here: `//evil.com` and `/\evil.com` resolve to a different origin (WHATWG
 * treats `\` as `/` in special schemes), `https://evil.com` obviously does, and
 * percent-encoded or control-character variants are normalised before the
 * origin comparison rather than after it.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/profile",
): string {
  if (!raw) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }

  if (parsed.origin !== SENTINEL_ORIGIN) return fallback;

  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return path.startsWith("/") ? path : fallback;
}

/**
 * What counts as "this is happening right now".
 *
 * A scan is an in-person event — the other person is standing there. Two
 * minutes covers a phone that was locked or backgrounded across the scan and
 * unlocked straight after, which is the ordinary case. It is deliberately
 * short: acting as though an encounter is live when the two of them walked away
 * from each other ten minutes ago is worse than doing nothing.
 *
 * TWO CALLERS, ONE NUMBER. The scanned person's redirect
 * (components/connection-listener.tsx) and the auto-opening contact sheet
 * (components/auto-save-contact.tsx) are the two halves of the same judgement,
 * and they were about to be two constants that could drift apart.
 */
export const FRESH_MS = 120_000;

/**
 * Whether a connection is fresh enough to act on without being asked.
 *
 * THIS IS THE WHOLE TRIGGER RULE FOR OPENING SOMEONE'S CONTACT SHEET, and the
 * reason it is a timestamp rather than a flag in the URL. `/u/{handle}` is a
 * public page: anyone can open it, share it, or land on it from their own
 * connections list. A marker in the URL that says "a scan just happened" is a
 * marker anyone can copy, and it survives a refresh, so it fires again.
 * `connections.connected_at` is written by `connect_via_scan`, readable only by
 * the two parties, and cannot be forged by anyone at all.
 *
 * EVALUATE IT ON THE SERVER. The comparison is against the caller's clock, and
 * a device with a wrong clock would otherwise decide for itself that every
 * connection is live.
 */
export function isFreshEncounter(
  connectedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!connectedAt) return false;
  const at = new Date(connectedAt).getTime();
  if (Number.isNaN(at)) return false;
  // Future timestamps are clock skew between the database and this process, not
  // a connection that has not happened yet — treat them as just-now rather than
  // as stale, which is the direction that keeps a real encounter working.
  return now - at < FRESH_MS;
}

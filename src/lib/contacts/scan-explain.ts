/**
 * Why a scan didn't connect, in words.
 *
 * Carried as `?e=` on wherever the redemption route sends someone (see
 * app/connect/[token]/route.ts). DISPLAY ONLY — it selects a sentence and
 * nothing else, so a forged one is a sentence somebody typed to themselves. The
 * page renders identically whatever it says.
 *
 * Shared because a failed scan lands in one of two places depending on whether
 * the token resolved to anybody: their page, or back at the scanner. The same
 * failure must not be explained two different ways.
 */
export const SCAN_EXPLAIN: Record<string, string> = {
  // Covers a genuinely expired token AND a block, deliberately: `connect_via_scan`
  // returns the same status for both, because a distinct message would confirm
  // to a blocked person that one specific someone blocked them.
  expired:
    "That code is no longer active. Ask them for their current one — codes change every few minutes.",
  slow: "You've scanned a lot in a short space of time. Wait a minute and try again — nothing has gone wrong with your account.",
};

export function scanExplanation(raw: string | undefined | null): string | null {
  return raw ? (SCAN_EXPLAIN[raw] ?? null) : null;
}

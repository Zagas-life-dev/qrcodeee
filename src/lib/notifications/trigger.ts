import { after } from "next/server";

import { log } from "@/lib/observability";
import { runNotificationWorker } from "@/lib/notifications/worker";
import { workerMode } from "@/lib/notifications/schedule";

/**
 * Drains one profile's change events right after that profile is edited.
 *
 * THIS IS WHAT MAKES DELIVERY FEEL LIVE ON VERCEL HOBBY. Cron there is capped at
 * once per day, so waiting for it means a connection learns about your new phone
 * number up to 24 hours later. But the work only ever needs doing when someone
 * has just changed something — which is exactly the moment we are already in.
 *
 * Runs inside `after()`, so the user's save returns immediately and the fan-out
 * happens once the response is sent. Never throws into the caller: a failed
 * fan-out leaves the events unprocessed, which is precisely the state the cron
 * and the Database Webhook exist to recover from.
 *
 * Scoped to one profile rather than sweeping the whole backlog, so a user's save
 * never pays for unrelated work. Safe to fire on every edit: overlapping runs hit
 * the per-profile advisory lock and back off (§5.4), and §7 caps profile
 * mutations at 60/hour anyway.
 */
export function triggerFanOut(profileId: string): void {
  if (workerMode() === "off") return;

  after(async () => {
    try {
      const summary = await runNotificationWorker({
        profileIds: [profileId],
        // Short: this is riding on a user request, not a cron slot.
        budgetMs: 10_000,
      });
      if (summary.notified > 0) {
        log.info("fanout.opportunistic", {
          profileId,
          notified: summary.notified,
          pushed: summary.pushed,
        });
      }
    } catch (cause) {
      log.warn("fanout.opportunistic.failed", {
        profileId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
}

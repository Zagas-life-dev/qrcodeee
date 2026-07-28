import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToProfile } from "@/lib/push/send";

/**
 * Drives the §5.4 fan-out.
 *
 * Deliberately thin: every concurrency-sensitive decision — the advisory lock,
 * the batch boundary, the watermark arithmetic, the a/b slot mapping — lives in
 * process_change_batch, because those need transaction control that PostgREST
 * cannot give a JavaScript caller. This just loops until the SQL says done.
 */

/** Batches per profile before yielding, so one huge profile can't monopolise a run. */
const MAX_BATCHES_PER_PROFILE = 40;

type BatchResult = {
  locked: boolean;
  done: boolean;
  cursor?: string;
  batch_version?: number;
  version?: number;
  notified?: number;
  connections?: number;
  events?: number;
};

export type WorkerSummary = {
  profiles: number;
  skippedLocked: number;
  notified: number;
  pushed: number;
  truncated: string[];
};

export async function runNotificationWorker(
  { profileLimit = 50 }: { profileLimit?: number } = {},
): Promise<WorkerSummary> {
  const admin = createAdminClient();

  const { data: pending, error } = await admin.rpc("pending_change_profiles", {
    p_limit: profileLimit,
  });
  if (error) throw new Error(`pending_change_profiles: ${error.message}`);

  const summary: WorkerSummary = {
    profiles: 0,
    skippedLocked: 0,
    notified: 0,
    pushed: 0,
    truncated: [],
  };

  for (const profileId of (pending ?? []) as unknown as string[]) {
    let cursor: string | null = null;
    let batchVersion: number | null = null;
    let notifiedForProfile = 0;
    let batches = 0;
    let finished = false;

    while (batches < MAX_BATCHES_PER_PROFILE) {
      const { data, error: batchError } = await admin.rpc("process_change_batch", {
        p_profile_id: profileId,
        p_cursor: cursor,
        p_batch_version: batchVersion,
      });
      if (batchError) throw new Error(`process_change_batch: ${batchError.message}`);

      const result = data as unknown as BatchResult;

      // Another run holds the lock and is already covering these events. Not an
      // error, and not something to retry — retrying is what the lock exists to
      // prevent.
      if (!result.locked) {
        summary.skippedLocked += 1;
        finished = true;
        break;
      }

      notifiedForProfile += result.notified ?? 0;
      batches += 1;

      if (result.done) {
        finished = true;
        break;
      }

      cursor = result.cursor ?? null;
      batchVersion = result.batch_version ?? batchVersion;
    }

    // Hit the ceiling without finishing. The events stay unprocessed, so the
    // next run resumes — safe because of the idempotency index and the monotonic
    // watermark. Surfaced rather than swallowed: a profile that shows up here
    // repeatedly is the "single profile with 100,000 connections" case §5.4
    // explicitly defers, and it needs a different notification model, not a
    // bigger loop.
    if (!finished) summary.truncated.push(profileId);

    if (notifiedForProfile > 0) {
      summary.profiles += 1;
      summary.notified += notifiedForProfile;
    }
  }

  // Push delivery for change notifications, for the app-closed case. Read back
  // from the rows the SQL just wrote rather than tracked in the loop, so a
  // retried batch that hit `on conflict do nothing` doesn't re-push.
  summary.pushed = await deliverPendingPushes(admin);

  return summary;
}

/**
 * Sends Web Push for unread change notifications created in the last few
 * minutes.
 *
 * Time-windowed rather than flag-based: adding a `pushed_at` column would be
 * more precise, but this runs every minute and a missed push degrades to the
 * reconcile-on-open path (§5.2 step 4), which has to work regardless. Worth
 * revisiting if push volume ever justifies the column.
 */
async function deliverPendingPushes(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();

  const { data: rows } = await admin
    .from("notifications")
    .select("recipient_id, source_profile_id, type, change_version")
    .in("type", ["major_change", "accumulated_changes"])
    .is("read_at", null)
    .gte("created_at", since)
    .limit(500);

  if (!rows?.length) return 0;

  const sourceIds = [...new Set(rows.map((r) => r.source_profile_id))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name")
    .in("id", sourceIds);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  let sent = 0;
  for (const row of rows) {
    const name = nameOf.get(row.source_profile_id) ?? "Someone";
    // Wording is generated here, not stored (§5.4 point 4) — and a
    // major_change must not claim to know WHICH detail changed, because the
    // event records field names only and the notification row doesn't carry them.
    const body =
      row.type === "major_change"
        ? `${name} updated their contact info. Your saved contact may be out of date.`
        : `${name} updated their profile.`;

    const result = await sendPushToProfile(row.recipient_id, {
      title: "QR Connect",
      body,
      url: "/notifications",
      // Collapses repeats for the same source+version instead of stacking.
      tag: `change:${row.source_profile_id}:${row.change_version}`,
    });
    sent += result.sent;
  }

  return sent;
}

import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push delivery (§5.2 step 3) — the only way to reach someone whose app is
 * closed. Realtime covers app-open; neither covers the other case.
 *
 * Uses the service role because it sends to OTHER people's devices: the scanned
 * person is by definition not the one making the request, so there is no session
 * whose RLS would grant access to their subscriptions.
 */

let configured = false;

function configure(): boolean {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    // A contact for the push service to reach if we misbehave. mailto: is what
    // the spec expects; a URL is also permitted.
    "mailto:notifications@qr-connect.app",
    publicKey,
    privateKey,
  );
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Collapses repeats of the same event rather than stacking duplicates. */
  tag?: string;
};

/**
 * Sends to every device registered to a profile.
 *
 * Never throws. A push failure must not take down the flow that triggered it —
 * the connection is already committed and the notification row already written,
 * so a dropped push degrades to "they find out when they next open the app",
 * which §5.2 step 4 requires to work anyway.
 */
export async function sendPushToProfile(
  profileId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const admin = createAdminClient();
  const { data: subscriptions } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);

  if (!subscriptions?.length) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        );
        sent += 1;
      } catch (cause) {
        // 404/410 from the push service means the browser install is gone for
        // good — uninstalled PWA, cleared site data, expired subscription.
        // Keeping those rows means retrying a guaranteed failure on every send
        // forever, so reap them. Any other status (network blip, 429, 500) is
        // transient and the row stays.
        const status = (cause as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(subscription.id);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  if (sent > 0) {
    await admin
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("profile_id", profileId);
  }

  return { sent, pruned: dead.length };
}

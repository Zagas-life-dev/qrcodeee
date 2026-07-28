"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * base64url -> Uint8Array, the format PushManager.subscribe expects.
 *
 * Backed by an explicitly allocated ArrayBuffer rather than Uint8Array.from:
 * since TypeScript 5.7 typed arrays are generic over their buffer, and `from`
 * produces Uint8Array<ArrayBufferLike>, which doesn't satisfy the BufferSource
 * that applicationServerKey requires (it could be a SharedArrayBuffer).
 */
function decodeVapidKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export type SubscribeOutcome = "subscribed" | "denied" | "unsupported" | "failed";

/**
 * Requests permission and registers a push subscription.
 *
 * MUST only be called from a user gesture that follows a real connection —
 * §5.2 is explicit that asking on first page load reliably trains people to
 * permanently deny, and a denial is not recoverable in-app: once the browser has
 * a "denied" permission it never prompts again, and the user has to go into site
 * settings. That makes the timing of this call a one-shot decision, not a
 * detail.
 */
export async function subscribeToPush(): Promise<SubscribeOutcome> {
  if (!pushSupported()) return "unsupported";

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const registration = (await navigator.serviceWorker.getRegistration("/")) ??
      (await registerServiceWorker());
    if (!registration) return "failed";
    await navigator.serviceWorker.ready;

    // Reuse an existing subscription rather than minting a second one for the
    // same install — subscribe() with different options would otherwise fail.
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every browser: silent pushes aren't permitted on the web.
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(vapidKey),
      }));

    const json = subscription.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return "failed";

    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent,
    });

    return error ? "failed" : "subscribed";
  } catch {
    return "failed";
  }
}

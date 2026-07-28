"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { pushSupported, subscribeToPush } from "@/lib/push/client";

/**
 * Notification.permission is browser-only state that differs between the server
 * render and the client, which is precisely what useSyncExternalStore's
 * server-snapshot argument exists for. Reading it in an effect and calling
 * setState would work, but it renders once with the wrong answer and back.
 *
 * The subscribe function is a no-op: permission changes only via the browser's
 * own UI, which emits no event, and a stale read here just means the prompt
 * stays hidden until the next navigation.
 */
const NO_CHANGES = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" =>
  pushSupported() ? Notification.permission : "unsupported";
const serverPermission = (): "unsupported" => "unsupported";

type Props = {
  /** Benefit framing for this placement. §5.2 requires it be concrete. */
  title?: string;
  body?: string;
};

/**
 * The permission prompt (§5.2).
 *
 * Two rules from the spec, both about timing rather than mechanics:
 *   - never ask on first page load — it reliably trains people to permanently
 *     deny, and a denial can't be undone from inside the app
 *   - frame it around the concrete benefit, not a bare browser prompt with no
 *     context
 *
 * So this renders as an explanation with a button, and the browser prompt only
 * appears once the user has opted in to being asked.
 *
 * The copy is a prop because WHERE this is asked determines what the honest
 * benefit is. On the connect page the user just connected; on the QR page they
 * are about to be scanned and the relevant promise is a different one. Asking
 * on the QR page is not an extra nag — it is the only place the person who gets
 * SCANNED can subscribe before the scan happens, and §5.2 step 3 makes push the
 * only way to reach them at all when their app is closed.
 */
export function EnableNotifications({ title, body }: Props = {}) {
  const permission = useSyncExternalStore(NO_CHANGES, readPermission, serverPermission);
  const [state, setState] = useState<"offer" | "working" | "resolved">("offer");

  // Only ever shown when the browser has made no decision yet. Once permission
  // is "denied" the browser will never prompt again — the user has to go into
  // site settings — so a button that silently does nothing is worse than none.
  if (permission !== "default" || state === "resolved") return null;

  return (
    <div className="mt-6 rounded-lg border border-current/15 p-4">
      <p className="text-sm font-medium">
        {title ?? "Get notified when your connections update their info"}
      </p>
      <p className="mt-1 text-sm opacity-70">
        {body ??
          "Phone numbers and email addresses change. We'll let you know when someone you've connected with updates theirs, so your saved contact doesn't go stale."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={state === "working"}
          onClick={async () => {
            setState("working");
            const outcome = await subscribeToPush();
            if (outcome === "subscribed") {
              toast.success("Notifications on");
            } else if (outcome === "denied") {
              toast("Notifications stay off", {
                description:
                  "You can turn them on later in your browser's site settings.",
              });
            } else {
              toast.error("Couldn't turn on notifications on this device.");
            }
            setState("resolved");
          }}
          className="rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
        >
          {state === "working" ? "Enabling…" : "Turn on notifications"}
        </button>
        <button
          type="button"
          onClick={() => setState("resolved")}
          className="rounded-md px-3 py-1.5 text-sm opacity-70 transition hover:bg-current/5 hover:opacity-100"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

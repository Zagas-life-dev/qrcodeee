"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { notificationText } from "@/lib/notifications/display";
import { markRead } from "@/lib/notifications/actions";
import { saveContact } from "@/lib/contacts/save-contact";
import { FRESH_MS } from "@/lib/contacts/encounter";
import type { NotificationType } from "@/lib/supabase/database.types";

/**
 * The scanned person's side of §5.2.
 *
 * The scanner is looking at their result on screen. The person whose code was
 * scanned took no action at all, so they need a different trigger path entirely:
 *
 *   app foreground -> Realtime, below. A live scan REDIRECTS them to the
 *                     scanner's public page, mirroring what the scanner is
 *                     already looking at, so one scan leaves both people holding
 *                     each other's contact.
 *   app returns    -> the reconcile pass, which ALSO redirects when the event is
 *                     recent enough to still be the same encounter.
 *   app closed     -> Web Push, which opens the same page on tap.
 *
 * The reconcile pass is not redundancy. §5.2 step 4 is explicit that Realtime
 * must not be trusted for delivery: a dropped websocket, a backgrounded tab, or
 * a device asleep during the insert all lose the event with no error anywhere.
 */

type Row = {
  id: string;
  type: string;
  source_profile_id: string;
  created_at?: string;
};

export function ConnectionListener({ userId }: { userId: string }) {
  const router = useRouter();
  // Notification ids already surfaced this session, so the reconcile pass and a
  // Realtime event for the same row can't produce two toasts or two redirects.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let channel: RealtimeChannel | null = null;

    function announce(row: Row, { live }: { live: boolean }) {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);

      void (async () => {
        // `handle` because the redirect below goes to the person's public page,
        // which is now the only page a person has in this product.
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, handle, deleted_at")
          .eq("id", row.source_profile_id)
          .maybeSingle();

        const name = profile?.deleted_at
          ? "A deleted account"
          : (profile?.name ?? "Someone");

        // A scan is a two-sided event, and this is the second side of it. The
        // scanner is already looking at the scanned person's profile with the
        // save open; this puts the scanned person on the SCANNER's profile with
        // the save open, so both people walk away with each other's contact from
        // the one scan. The two of them are standing together when this fires —
        // a prompt asking them to opt in to the thing they just agreed to in
        // person is a step that only loses people.
        //
        //   live            the encounter is still happening — either a Realtime
        //                   event, or a reconcile of a row younger than
        //                   FRESH_MS. Older rows fall through to the toast: they
        //                   would otherwise yank the user into a random
        //                   connection page every time they open the app.
        //   new_connection  never on major_change / accumulated_changes —
        //                   navigating someone away because a contact edited
        //                   their bio would be indefensible.
        //   not deleted     §8: no card worth opening.
        if (live && row.type === "new_connection" && !profile?.deleted_at && profile?.handle) {
          const target = `/u/${profile.handle}`;
          // Delivered as forcefully as this app can deliver anything, so it is
          // spent. Without this a refresh inside FRESH_MS re-fires the redirect,
          // and every refresh after it re-raises the toast.
          void markRead([row.id]);
          // Guards the mutual-scan case: if both people scan at once, whoever is
          // already on the other's page must not be bounced through it again and
          // lose the save they are mid-way through.
          //
          // NOTHING IS APPENDED TO THIS URL. It used to carry `?new=1` to earn
          // the auto-opening contact sheet; the target page now works that out
          // from how old the connection is (lib/contacts/encounter.ts), so
          // there is no marker here for anyone to copy into a shared link.
          if (window.location.pathname !== target) router.push(target);
          return;
        }

        // Copy is generated here from the structured row, never stored (§5.4
        // point 4) — so a wording change doesn't leave old notifications with
        // stale text, and the name is whatever it is right now (§1).
        const copy = notificationText(row.type as NotificationType, name);

        // Everything that is NOT a live encounter still gets §5.2 step 2's
        // prompt. A toast action click carries transient activation, so the save
        // can open straight from here without the intermediate page.
        const offerSave = row.type === "new_connection" && !profile?.deleted_at;

        // `seen` only survives until the page reloads, and the reconcile pass
        // selects on `read_at is null` — so without marking, a dismissed toast
        // comes back on every single refresh until the user happens to visit
        // /notifications. A toast that has run its course has been delivered,
        // whether it was dismissed, acted on, or simply timed out, which is the
        // same standard §5.5 applies when opening the list marks what's on
        // screen read. Repeat calls are no-ops: markRead filters on unread.
        const spend = () => void markRead([row.id]);

        toast(copy.title, {
          description: copy.body,
          duration: 10000,
          onDismiss: spend,
          onAutoClose: spend,
          action: offerSave
            ? {
                label: "Save contact",
                onClick: () => {
                  spend();
                  void saveContact(row.source_profile_id, name);
                },
              }
            : {
                label: "Notifications",
                onClick: () => {
                  spend();
                  router.push("/notifications");
                },
              },
        });
        router.refresh();
      })();
    }

    /**
     * Catches up on anything Realtime didn't deliver, and treats anything recent
     * as live. This is what makes the redirect survive a locked phone: B's screen
     * is off when A scans, the socket is asleep, and the row lands with nothing
     * listening — then B unlocks and lands on A's page without touching a
     * notification.
     */
    async function reconcile() {
      const { data } = await supabase
        .from("notifications")
        .select("id, type, source_profile_id, created_at")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5);

      for (const row of data ?? []) {
        const age = row.created_at ? Date.now() - new Date(row.created_at).getTime() : Infinity;
        announce(row, { live: age < FRESH_MS });
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void reconcile();
    }

    void (async () => {
      // THE SOCKET MUST BE AUTHENTICATED BEFORE IT SUBSCRIBES.
      //
      // supabase-js only pushes the access token to Realtime from an
      // onAuthStateChange handler, which fires asynchronously once the auth
      // client has loaded the session from cookies. Subscribing before that
      // lands — which is what a bare `useEffect` does — joins the channel with
      // nothing but the anon apikey. `notifications` is RLS'd to
      // `recipient_id = auth.uid()`, so every row is then filtered out for a
      // subscriber the server sees as anonymous.
      //
      // The failure mode is the reason this is spelled out: the channel still
      // reports SUBSCRIBED and no error is raised anywhere. It simply never
      // delivers, and the feature degrades to "works only if you tap the push
      // notification" with nothing in the console to explain why.
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      await supabase.realtime.setAuth(data.session?.access_token);
      if (disposed) return;

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            // RLS still applies to Realtime, so this filter is a bandwidth
            // optimisation rather than the security boundary — a wrong filter
            // would leak nothing, just deliver noise.
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => announce(payload.new as Row, { live: true }),
        )
        .subscribe();

      await reconcile();
    })();

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}

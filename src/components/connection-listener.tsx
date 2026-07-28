"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { notificationText } from "@/lib/notifications/display";
import { saveContact } from "@/lib/contacts/save-contact";
import type { NotificationType } from "@/lib/supabase/database.types";

/**
 * The scanned person's side of §5.2.
 *
 * The scanner is looking at their result on screen. The person whose code was
 * scanned took no action at all, so they need a different trigger path entirely:
 *
 *   app open   -> this component, via Realtime. A live scan REDIRECTS them to
 *                 the scanner's profile page, mirroring what the scanner is
 *                 already looking at, so one scan leaves both people holding
 *                 each other's contact.
 *   app closed -> Web Push (the service worker), which opens the same page
 *   on reopen  -> the reconcile pass below, which prompts rather than redirects
 *
 * That third one is not redundancy. §5.2 step 4 is explicit that Realtime must
 * not be trusted for delivery: a dropped websocket, a backgrounded tab, or a
 * device asleep during the insert all lose the event with no error anywhere.
 * Reconciling against unread rows on mount is what actually guarantees they find
 * out.
 */
export function ConnectionListener({ userId }: { userId: string }) {
  const router = useRouter();
  // Notification ids already surfaced this session, so the reconcile pass and a
  // Realtime event for the same row can't produce two toasts.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();

    function announce(
      row: { id: string; type: string; source_profile_id: string },
      { live }: { live: boolean },
    ) {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);

      void (async () => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, deleted_at")
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
        // a toast asking them to opt in to the thing they just agreed to in
        // person is a step that only loses people.
        //
        // Three conditions, all necessary:
        //
        //   live               a Realtime event means the scan is happening NOW.
        //                      The reconcile pass below replays up to five
        //                      UNREAD rows on every mount, and redirecting off
        //                      those would yank the user to a random connection
        //                      days later, every time they open the app.
        //   new_connection     never on major_change / accumulated_changes —
        //                      navigating someone away because a contact edited
        //                      their bio would be indefensible.
        //   not deleted        §8: no card worth opening.
        const redirect =
          live && row.type === "new_connection" && !profile?.deleted_at;

        if (redirect) {
          const target = `/connections/${row.source_profile_id}`;
          // Guards the mutual-scan case: if both people scan at once, whoever is
          // already on the other's page must not be bounced through it again and
          // lose the save they are mid-way through.
          if (window.location.pathname !== target) router.push(target);
          return;
        }

        // Copy is generated here from the structured row, never stored (§5.4
        // point 4) — so a wording change doesn't leave old notifications with
        // stale text, and the name is whatever it is right now (§1).
        const copy = notificationText(row.type as NotificationType, name);

        // Everything that is NOT a live scan still gets §5.2 step 2's prompt
        // rather than a redirect. A toast action click carries transient
        // activation, so the save can open straight from here without the
        // intermediate page.
        const offerSave = row.type === "new_connection" && !profile?.deleted_at;

        toast(copy.title, {
          description: copy.body,
          duration: 10000,
          action: offerSave
            ? {
                label: "Save contact",
                onClick: () => {
                  void saveContact(row.source_profile_id, name);
                },
              }
            : {
                label: "Notifications",
                onClick: () => router.push("/notifications"),
              },
        });
        router.refresh();
      })();
    }

    // 1. Catch up on anything missed while the app was closed or the socket down.
    void (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, type, source_profile_id")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5);

      for (const row of data ?? []) announce(row, { live: false });
    })();

    // 2. Live delivery while the app is open. RLS still applies to Realtime, so
    //    the filter is a bandwidth optimisation rather than the security
    //    boundary — a wrong filter would leak nothing, just deliver noise.
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          announce(payload.new as { id: string; type: string; source_profile_id: string }, {
            live: true,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { notificationText } from "@/lib/notifications/display";
import type { NotificationType } from "@/lib/supabase/database.types";

/**
 * The scanned person's side of §5.2.
 *
 * The scanner is looking at their result on screen. The person whose code was
 * scanned took no action at all, so they need a different trigger path entirely:
 *
 *   app open   -> this component, via Realtime
 *   app closed -> Web Push (the service worker)
 *   on reopen  -> the reconcile pass below
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

    function announce(row: { id: string; type: string; source_profile_id: string }) {
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

        // Copy is generated here from the structured row, never stored (§5.4
        // point 4) — so a wording change doesn't leave old notifications with
        // stale text, and the name is whatever it is right now (§1).
        const copy = notificationText(row.type as NotificationType, name);

        toast(copy.title, {
          description: copy.body,
          duration: 10000,
          action: {
            label: row.type === "new_connection" ? "View" : "Notifications",
            onClick: () =>
              router.push(row.type === "new_connection" ? "/connections" : "/notifications"),
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

      for (const row of data ?? []) announce(row);
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
          announce(payload.new as { id: string; type: string; source_profile_id: string });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}

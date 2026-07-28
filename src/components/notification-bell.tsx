"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

/**
 * Bell + unread badge (§5.5).
 *
 * Counts rows where read_at is null, which is exactly what the partial index
 * notifications_unread_idx is for — it stays proportional to unread count rather
 * than to total notification history.
 */
export function NotificationBell({ userId, initialCount }: { userId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const supabase = createClient();

    async function refresh() {
      const { count: unread } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      setCount(unread ?? 0);
    }

    // Recount rather than increment. An increment would drift out of sync with
    // reality the moment a notification is read in another tab, or one arrives
    // while the socket is down — and §5.2 step 4 requires not trusting Realtime
    // for delivery in the first place.
    const channel = supabase
      .channel(`bell:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();

    void refresh();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <Link
      href="/notifications"
      className="relative ml-auto rounded-md px-2.5 py-1.5 opacity-70 transition hover:bg-current/5 hover:opacity-100"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-medium leading-4 text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

import { BellIcon } from "./nav-icons";

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
      // A square 44px target rather than padding around an 18px glyph, which
      // came out 34px tall — under the touch minimum, and this is the only
      // control in the header on a phone.
      className="relative ml-auto flex size-11 shrink-0 items-center justify-center rounded-brutal border-2 border-ink bg-paper shadow-brutal-sm nb-press-sm"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
    >
      <BellIcon className="size-5" />
      {count > 0 ? (
        // Pulled inside the button's own bounds: at -top-2 the badge sat above
        // the header's padding box, where a phone with no notch (or an
        // installed PWA reporting a zero top inset) clips its upper edge.
        <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full border-2 border-ink bg-coral px-1 text-[10px] font-bold tabular-nums leading-4 text-ink">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

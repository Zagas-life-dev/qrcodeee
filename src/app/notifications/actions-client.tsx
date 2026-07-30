"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { markAllRead, markRead } from "@/lib/notifications/actions";

/**
 * Marks the notifications that were on screen as read (§5.5).
 *
 * Fires once per set of ids rather than on every render — a router.refresh()
 * from the Realtime listener re-renders this, and without the guard each refresh
 * would re-issue the same write.
 */
export function MarkOnOpen({ ids }: { ids: string[] }) {
  const done = useRef<string>("");

  useEffect(() => {
    if (ids.length === 0) return;
    const key = ids.join(",");
    if (done.current === key) return;
    done.current = key;
    void markRead(ids);
  }, [ids]);

  return null;
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await markAllRead();
          router.refresh();
        })
      }
      className="min-h-10 rounded-brutal border-2 border-ink bg-paper px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
    >
      {isPending ? "Marking…" : "Mark all read"}
    </button>
  );
}

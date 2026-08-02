"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { unblockProfile } from "@/lib/connections/actions";

export function UnblockButton({ profileId, name }: { profileId: string; name: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 shrink-0 rounded-full border-2 border-ink bg-paper px-3.5 text-xs font-semibold shadow-brutal-sm nb-press-sm"
      >
        Unblock
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs font-semibold">Sure?</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await unblockProfile(profileId);
            if (result.ok) toast.success(`${name} unblocked`);
            else toast.error(result.message);
            setConfirming(false);
            router.refresh();
          })
        }
        className="min-h-11 rounded-full border-2 border-ink bg-lime px-3.5 text-xs font-semibold shadow-brutal-sm nb-press-sm disabled:opacity-50"
      >
        {isPending ? "…" : "Unblock"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-11 rounded-full border-2 border-ink bg-paper px-3.5 text-xs font-semibold shadow-brutal-sm nb-press-sm"
      >
        No
      </button>
    </div>
  );
}

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
        className="shrink-0 rounded-md border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5"
      >
        Unblock
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs opacity-60">Sure?</span>
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
        className="rounded-md border border-current/15 px-2.5 py-1 text-xs font-medium transition hover:bg-current/5 disabled:opacity-50"
      >
        {isPending ? "…" : "Unblock"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2 py-1 text-xs opacity-60 transition hover:bg-current/5 hover:opacity-100"
      >
        No
      </button>
    </div>
  );
}

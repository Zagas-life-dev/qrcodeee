"use client";

import { useState } from "react";
import { toast } from "sonner";

import { saveContact } from "@/lib/contacts/save-contact";

type Props = {
  profileId: string;
  name: string;
  className?: string;
  /** Focused on mount when arriving from a push deep link (§5.2 step 3). */
  autoFocus?: boolean;
  children?: React.ReactNode;
};

/**
 * Triggers the OS Add Contact flow (§5.2).
 *
 * THE COPY IS PART OF THE SPEC, and it now lives with the flow itself in
 * src/lib/contacts/save-contact.ts — the scanned person reaches that same flow
 * from a toast and a push deep link, where there is no button to hang copy off.
 */
export function SaveContactButton({
  profileId,
  name,
  className,
  autoFocus,
  children,
}: Props) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      autoFocus={autoFocus}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await saveContact(profileId, name);
        } catch {
          toast.error("Couldn't build that contact card.");
        } finally {
          setBusy(false);
        }
      }}
      className={
        className ??
        "rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
      }
    >
      {busy ? "Preparing…" : (children ?? "Save to contacts")}
    </button>
  );
}

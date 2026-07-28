"use client";

import { useState } from "react";
import { toast } from "sonner";

type Props = { profileId: string; name: string; className?: string };

/**
 * Triggers the OS Add Contact flow (§5.2).
 *
 * THE COPY IS PART OF THE SPEC. A browser cannot confirm the operating system
 * actually wrote a contact — Web Share resolves when the sheet is dismissed, not
 * when the contact is saved, and a download resolves when bytes hit disk. So
 * this never says "Contact saved"; it says the card is ready and points at the
 * Add Contact prompt. §1 calls this out directly: never overclaim what happened.
 */
export function SaveContactButton({ profileId, name, className }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      const response = await fetch(`/api/contacts/${profileId}/vcard`);
      if (!response.ok) {
        toast.error(
          response.status === 410
            ? "That account was deleted, so there's no contact card to save."
            : "Couldn't build that contact card.",
        );
        return;
      }

      const blob = await response.blob();
      const file = new File([blob], `${name.replace(/[^\p{L}\p{N} _-]/gu, "") || "contact"}.vcf`, {
        type: "text/vcard",
      });

      // Web Share with a file gives the native "Add to Contacts" sheet on iOS
      // and Android, which is the closest a PWA gets to a real contact write.
      // canShare({files}) is the only reliable capability check — plenty of
      // browsers expose navigator.share but reject files.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          toast.success("Contact ready to save", {
            description: "Choose Add to Contacts in the share sheet.",
          });
          return;
        } catch (cause) {
          // The user dismissing the sheet is not an error worth reporting.
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          // Anything else: fall through to the download path.
        }
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast.success("Contact card downloaded", {
        description: "Open it to add them to your contacts.",
      });
    } catch {
      toast.error("Couldn't build that contact card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={busy}
      className={
        className ??
        "rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
      }
    >
      {busy ? "Preparing…" : "Save to contacts"}
    </button>
  );
}

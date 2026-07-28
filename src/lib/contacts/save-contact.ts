"use client";

import { toast } from "sonner";

/**
 * The single path a `.vcf` takes into someone's address book (§5.2).
 *
 * Extracted out of SaveContactButton because the SCANNED person never touches
 * that button — they arrive from a Realtime toast (§5.2 step 2) or a Web Push
 * deep link (step 3). Those are the flows §5.2 calls out as genuinely separate,
 * and they have to make the same promise about what happened. One
 * implementation means the "never say saved" rule below can't drift out of sync
 * across three call sites.
 *
 * MUST be called from a user gesture. navigator.share() requires transient
 * activation, so there is no version of this that fires on page load: the
 * "automatic" save is an automatically PRESENTED prompt, never an automatic
 * write. The web has no silent contact write — §10 lists a native app as the
 * only route to one — so presenting the OS prompt at the right moment is the
 * ceiling, and it is what this reaches for.
 */
export async function saveContact(profileId: string, name: string): Promise<void> {
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
  const file = new File(
    [blob],
    `${name.replace(/[^\p{L}\p{N} _-]/gu, "") || "contact"}.vcf`,
    { type: "text/vcard" },
  );

  // Web Share with a file gives the native "Add to Contacts" sheet on iOS and
  // Android, which is the closest a PWA gets to a real contact write.
  // canShare({files}) is the only reliable capability check — plenty of browsers
  // expose navigator.share but reject files.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      // §5.2 point 3: a browser cannot confirm the OS actually wrote a contact.
      // Web Share resolves when the sheet is DISMISSED, not when the contact is
      // saved. So this says the card is ready, never that it was saved (§1).
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
}

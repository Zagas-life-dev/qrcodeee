"use client";

import { toast } from "sonner";

/**
 * The single path a contact takes into someone's address book (§5.2).
 *
 * Extracted out of SaveContactButton because the SCANNED person never touches
 * that button — they arrive from a Realtime toast (§5.2 step 2) or a Web Push
 * deep link (step 3). Those are the flows §5.2 calls out as genuinely separate,
 * and they have to make the same promise about what happened.
 *
 * ── Why this is a navigation and not a download ────────────────────────────
 *
 * The goal is the OS "New Contact" screen, already filled in — one tap, no file
 * in Downloads that the user then has to find and open. Three platforms, three
 * different mechanisms, and the difference is NOT cosmetic:
 *
 *   iOS      Safari renders an INLINE `text/vcard` response as the Add Contact
 *            sheet, with a "Create New Contact" / "Add to Existing Contact"
 *            action. The identical bytes sent as `Content-Disposition:
 *            attachment` are merely a file. So the disposition header is the
 *            entire difference between what the user asked for and what they
 *            were getting.
 *
 *   Android  Chrome will not render a vCard at all — it downloads it. The
 *            prefilled editor comes from an `intent://` URL carrying
 *            ACTION_INSERT plus ContactsContract extras.
 *
 *   Desktop  A download is genuinely correct: the .vcf opens in Outlook /
 *            Contacts, and there is no OS sheet to reach for.
 *
 * MUST be called from a user gesture — Chrome refuses to launch an intent URL
 * without one, and every path here is a navigation. There is still no silent
 * write anywhere in this: the OS always shows its own screen and the user
 * always confirms. §10 lists a native app as the only route to a true silent
 * write, and that has not changed.
 */

const IOS = /iPad|iPhone|iPod/;
const ANDROID = /Android/i;

function isIOS(): boolean {
  // iPadOS reports as MacIntel and only a touch-point count distinguishes it.
  return (
    IOS.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether saveContact() can usefully be fired on page load rather than from a
 * tap. Only iOS — and the reason is per-platform, not caution:
 *
 *   iOS      the flow is a navigation to an inline vCard, which needs no user
 *            activation. Safari presents the contact sheet over the page.
 *   Android  Chrome explicitly refuses to launch an intent URL that wasn't
 *            initiated by a user gesture. Auto-firing there does nothing at
 *            best, and silently falls through to a download at worst.
 *   Desktop  the flow is a file download. Firing one on page load is hostile
 *            and browsers increasingly block it outright.
 *
 * Every caller must still render a real button — this is an accelerator for the
 * platform that supports it, never the only way to reach the save.
 */
export function canAutoTrigger(): boolean {
  return typeof navigator !== "undefined" && !ANDROID.test(navigator.userAgent) && isIOS();
}

/**
 * ACTION_INSERT against ContactsContract, as an intent URL Chrome can navigate.
 *
 * `browser_fallback_url` is load-bearing rather than defensive: Chrome only
 * launches activities that declare `android.intent.category.BROWSABLE`, and
 * whether the device's contacts editor does is up to whichever contacts app is
 * installed — Google Contacts, a manufacturer's replacement, or none. When it
 * doesn't resolve, Chrome silently navigates to the fallback instead of
 * erroring, which lands the user on the vCard. So the worst case here is the
 * behaviour we'd have had anyway, and the best case is the prefilled editor.
 */
function androidInsertUrl(
  details: { name: string; phone: string | null; email: string | null },
  fallbackUrl: string,
): string {
  const extras = [
    `S.name=${encodeURIComponent(details.name)}`,
    details.phone ? `S.phone=${encodeURIComponent(details.phone)}` : null,
    details.email ? `S.email=${encodeURIComponent(details.email)}` : null,
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`,
  ].filter(Boolean);

  return [
    "intent:#Intent",
    "action=android.intent.action.INSERT",
    "type=vnd.android.cursor.dir/contact",
    ...extras,
    "end",
  ].join(";");
}

export async function saveContact(profileId: string, name: string): Promise<void> {
  const base = `/api/contacts/${encodeURIComponent(profileId)}/vcard`;
  const inlineUrl = `${base}?disposition=inline`;

  if (ANDROID.test(navigator.userAgent)) {
    // Fetched rather than read from props: the button only ever knows a name,
    // and the intent needs the phone and email — which are authorisation-gated
    // and so can only come from the server that already checks the connection.
    try {
      const response = await fetch(`${base}?format=json`);
      if (response.ok) {
        const details = (await response.json()) as {
          name: string;
          phone: string | null;
          email: string | null;
        };
        window.location.href = androidInsertUrl(
          details,
          new URL(inlineUrl, window.location.origin).href,
        );
        return;
      }
      if (response.status === 410) {
        toast.error("That account was deleted, so there's no contact to save.");
        return;
      }
    } catch {
      // Fall through to the vCard, which needs no round trip of its own.
    }
    window.location.href = inlineUrl;
    return;
  }

  if (isIOS()) {
    // Safari intercepts this and presents the contact sheet over the page —
    // it does not navigate away, so there is nothing to restore afterwards.
    window.location.href = inlineUrl;
    return;
  }

  // Desktop: a real download, opened by the OS contacts app. Fetched as a blob
  // rather than navigated to so a failure is a toast instead of an error page.
  const response = await fetch(base);
  if (!response.ok) {
    toast.error(
      response.status === 410
        ? "That account was deleted, so there's no contact card to save."
        : "Couldn't build that contact card.",
    );
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^\p{L}\p{N} _-]/gu, "") || "contact"}.vcf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  // §5.2 point 3 / §1: never claim the contact was SAVED. Nothing here can
  // observe whether the OS wrote anything, so this reports only what is
  // actually known — that the file reached the machine.
  toast.success("Contact card downloaded", {
    description: "Open it to add them to your contacts.",
  });
}

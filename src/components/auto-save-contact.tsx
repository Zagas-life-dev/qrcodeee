"use client";

import { useEffect, useRef, useState } from "react";

import { canAutoTrigger, saveContact } from "@/lib/contacts/save-contact";
import { SaveContactButton } from "@/components/save-contact-button";

/**
 * Opens the OS contact screen on arrival, without waiting for a tap.
 *
 * This is only reachable on iOS — see canAutoTrigger() for why Android and
 * desktop cannot honour it. The button below is therefore not a fallback for
 * failure, it is the ONLY path on those platforms, and it renders unconditionally
 * for that reason. A user who dismisses the auto-opened sheet also needs
 * something to tap to get it back.
 *
 * The ref guard is not paranoia: React runs effects twice in development under
 * Strict Mode, and without it the contact sheet is requested twice on every
 * load.
 */
export function AutoSaveContact({
  profileId,
  name,
  auto = true,
}: {
  profileId: string;
  name: string;
  /**
   * Whether arriving here counts as a live encounter.
   *
   * False when someone simply tapped this person in their connections list —
   * the button below is then the only way the sheet opens. Auto-opening the OS
   * contact screen is right when a scan just happened and both people are
   * standing there; it is hostile when you are browsing your own list.
   */
  auto?: boolean;
}) {
  const fired = useRef(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!auto || fired.current || !canAutoTrigger()) return;
    fired.current = true;
    setOpened(true);
    void saveContact(profileId, name);
  }, [auto, profileId, name]);

  return (
    <div>
      <SaveContactButton
        profileId={profileId}
        name={name}
        autoFocus
        className="w-full rounded-full border-2 border-ink bg-lime px-3 py-3 text-sm font-semibold shadow-brutal nb-press disabled:opacity-50"
      >
        {opened ? `Open ${name}'s contact again` : `Save ${name} to contacts`}
      </SaveContactButton>
      {opened ? (
        <p className="mt-3 text-xs font-medium text-ink/70">
          Your contacts should have opened. If nothing appeared, tap above.
        </p>
      ) : null}
    </div>
  );
}

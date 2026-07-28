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
}: {
  profileId: string;
  name: string;
}) {
  const fired = useRef(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (fired.current || !canAutoTrigger()) return;
    fired.current = true;
    setAuto(true);
    void saveContact(profileId, name);
  }, [profileId, name]);

  return (
    <div>
      <SaveContactButton
        profileId={profileId}
        name={name}
        autoFocus
        className="w-full rounded-md border border-current/25 bg-current/5 px-3 py-2.5 text-sm font-medium transition hover:bg-current/10 disabled:opacity-50"
      >
        {auto ? `Open ${name}'s contact again` : `Save ${name} to contacts`}
      </SaveContactButton>
      {auto ? (
        <p className="mt-2 text-xs opacity-60">
          Your contacts should have opened. If nothing appeared, tap above.
        </p>
      ) : null}
    </div>
  );
}

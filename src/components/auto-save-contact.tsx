"use client";

import { useEffect, useRef, useState } from "react";

import { canAutoTrigger, saveContact } from "@/lib/contacts/save-contact";
import { SaveContactButton } from "@/components/save-contact-button";

/**
 * The contact save, and the rule for when it may open by itself.
 *
 * THE RULE, IN FULL:
 *
 *     auto-open  ⟺  the viewer is connected
 *                ∧  the connection is less than two minutes old
 *                ∧  this browser hasn't already opened it for this epoch
 *                ∧  the platform can honour it at all
 *
 * WHY IT IS NOT A FLAG IN THE URL, which is what it used to be (`?new=1`). This
 * component now lives on `/u/{handle}` — a public page anyone can open, share,
 * or reach from their own connections list. A query parameter saying "a scan
 * just happened" is one anyone can copy into a link, and it survives a refresh,
 * so it fires again every time. `connected` and `fresh` are both computed on the
 * server from `connections.connected_at`, a row only the two parties can read
 * and nobody can write directly.
 *
 * WHY THE EPOCH IS IN THE KEY. `connection_epoch` increments on every
 * reactivation, so a genuine disconnect-and-reconnect is a new encounter and
 * gets a new sheet — the same distinction `connect_via_scan` already makes when
 * it decides whether to write another notification.
 *
 * The auto-open is only reachable on iOS — see `canAutoTrigger()` for why
 * Android and desktop cannot honour it. The button below is therefore not a
 * fallback for failure, it is the ONLY path on those platforms, and it renders
 * unconditionally for that reason. Someone who dismisses the opened sheet also
 * needs something to tap to get it back.
 */
export function AutoSaveContact({
  profileId,
  name,
  epoch,
  fresh,
}: {
  profileId: string;
  name: string;
  /** `connections.connection_epoch` — which encounter this is. */
  epoch: number;
  /** Computed server-side. See isFreshEncounter in lib/contacts/encounter.ts. */
  fresh: boolean;
}) {
  const fired = useRef(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!fresh || fired.current || !canAutoTrigger()) return;
    // The ref guard is not paranoia — React runs effects twice in development
    // under Strict Mode — but it only lasts as long as the component. The
    // stored key is what stops a refresh inside the two-minute window opening
    // the sheet a second time, which on iOS means a contact screen thrown at
    // someone who has already dealt with it.
    const key = `sk:saved:${profileId}:${epoch}`;
    if (readFlag(key)) return;

    fired.current = true;
    writeFlag(key);
    // `opened` is set from the callback rather than synchronously in the effect
    // body — a synchronous setState here is a cascading render, and this one
    // would also be claiming the sheet had opened a beat before it was asked
    // for. On iOS `saveContact` resolves as soon as the navigation is handed to
    // Safari, so the difference is a microtask, not a delay anyone sees.
    void saveContact(profileId, name).then(() => setOpened(true));
  }, [fresh, profileId, name, epoch]);

  return (
    <div>
      <SaveContactButton
        profileId={profileId}
        name={name}
        // Focused when this is a live encounter, which is also the case where
        // the platform may not have opened anything: a scanner on Android is
        // standing in front of someone, and the save should be under their
        // thumb rather than somewhere down the page.
        autoFocus={fresh}
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

/**
 * localStorage, defensively.
 *
 * Safari in private browsing and any browser with site data blocked throw on
 * access rather than returning null. Losing the guard is survivable — the worst
 * case is the sheet opening twice inside two minutes — but throwing here would
 * take down the page that just told two people they are connected.
 */
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // See readFlag.
  }
}

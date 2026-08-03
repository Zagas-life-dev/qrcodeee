"use client";

import { useState } from "react";
import Link from "next/link";

import { useSiteStore } from "@/lib/site/store";

import { SyncStatus } from "./sync-status";

/**
 * The editor's own bar: what this page IS, what state it is in, and the two
 * controls that act on the whole of it.
 *
 * WHY IT EXISTS. The publish state used to be a full-width lemon/lime card
 * wedged between the page heading and the first section, the "View" link was a
 * pill in the heading row, and the save indicator was a second sticky element
 * with its own offset. Three answers to "what is happening to my page" in three
 * places, all of them scrolling away. They are one bar now, and it is pinned
 * directly under the app header.
 *
 * PUBLISH IS A SEGMENTED CONTROL, NOT A BUTTON THAT SAYS THE OPPOSITE OF THE
 * TRUTH. The old control read "Publish my page" when hidden and "Hide my page"
 * when live, which is the standard trap: the label describes the ACTION while
 * the surrounding card describes the STATE, so at a glance the bar appears to
 * say both. Two options with one of them pressed says the state and offers the
 * change in the same shape, and it is the same idiom the inspector's tabs use.
 */
export function EditorToolbar({
  handle,
  publicUrl,
  onOpenPanel,
}: {
  handle: string;
  publicUrl: string;
  /** Below `xl` the inspector is a sheet; these buttons are what open it. */
  onOpenPanel: (tab: "add" | "design") => void;
}) {
  const { site, mutate } = useSiteStore();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). The
      // URL is displayed in full beside this, so there is a manual path and
      // nothing to report.
    }
  };

  return (
    <div
      // Sticks under the app header rather than at 0: two sticky bars at the
      // same offset means the second one slides under the first.
      className="nb-glass-chrome sticky top-[calc(var(--shell-header-h)+env(safe-area-inset-top))] z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-ink px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="min-w-0">
        <h1 className="font-display text-xl leading-none tracking-tight">Your page</h1>
        <p className="mt-1 truncate font-mono text-xs text-ink/70">/u/{handle}</p>
      </div>

      <SyncStatus />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Below xl the inspector has no rail to live in, so it opens as a
            sheet. Above xl it is already on screen and these would be two
            buttons that scroll a panel you are looking at. */}
        <button
          type="button"
          onClick={() => onOpenPanel("add")}
          className="min-h-9 rounded-full border-2 border-ink bg-lilac px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm xl:hidden"
        >
          ＋ Add
        </button>
        <button
          type="button"
          onClick={() => onOpenPanel("design")}
          className="min-h-9 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm xl:hidden"
        >
          Design
        </button>

        <div
          role="group"
          aria-label="Page visibility"
          className="flex items-center gap-1 rounded-full border-2 border-ink bg-paper p-1 shadow-brutal-sm"
        >
          <PublishOption
            pressed={!site.published}
            onClick={() => mutate({ kind: "setPublished", published: false })}
            tone="bg-lemon"
          >
            Hidden
          </PublishOption>
          <PublishOption
            pressed={site.published}
            onClick={() => mutate({ kind: "setPublished", published: true })}
            tone="bg-lime"
          >
            Live
          </PublishOption>
        </div>

        <button
          type="button"
          onClick={copy}
          className="min-h-9 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          {copied ? "Copied" : "Copy link"}
        </button>

        <Link
          href={`/u/${handle}`}
          className="min-h-9 rounded-full border-2 border-ink bg-paper px-3.5 py-1.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          View ↗
        </Link>
      </div>
    </div>
  );
}

function PublishOption({
  pressed,
  tone,
  onClick,
  children,
}: {
  pressed: boolean;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-7 rounded-full px-3 text-xs font-semibold transition-colors duration-[--dur-fast] ${
        pressed ? `border-2 border-ink ${tone}` : "border-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

"use client";

import { useActionState, useState } from "react";

import { updateHandle, type HandleFormState } from "@/lib/handles/actions";
import { MAX_HANDLE_LENGTH, handleProblem, normalizeHandle } from "@/lib/handles/format";
import { Section } from "@/components/page";

const INITIAL: HandleFormState = { status: "idle" };

/**
 * The handle editor.
 *
 * The whole design problem here is that a handle is the one profile field with
 * consequences OUTSIDE the app — it is printed on cards and encoded in QR codes
 * — while looking exactly like an ordinary text input. So the form states the
 * two things that make it different, before the change rather than after:
 * old links redirect, and there are only two changes per 90 days.
 *
 * Live validation is local (`handleProblem`) and never speculative about
 * AVAILABILITY. A "checking…" spinner per keystroke would mean a request per
 * keystroke against a table anyone can probe, and an availability answer that is
 * stale by the time the form submits anyway. Format problems are knowable
 * offline and are reported instantly; whether someone else has the name is
 * answered once, by the server, on submit.
 */
export function HandleForm({ handle, origin }: { handle: string; origin: string }) {
  const [state, formAction, pending] = useActionState(updateHandle, INITIAL);

  // The handle in effect: whatever the last successful save returned, else the
  // one the server rendered. Without this the preview keeps showing the old
  // handle after a successful change until the page is reloaded.
  const current = state.handle ?? handle;
  const [draft, setDraft] = useState(handle);

  const normalized = normalizeHandle(draft);
  const changed = normalized !== current;
  // Only nag once they've actually typed something wrong — an untouched field
  // showing an error is the form telling the user off for arriving.
  const localProblem = changed ? handleProblem(normalized) : null;

  return (
    <Section
      title="Your link"
      description="The permanent address for your profile. Anyone can open it — your phone and email stay hidden until they connect with you."
      // The link to the page editor used to live here, because the dock had no
      // slot for it. It has one now (components/nav-items.ts) and the rail
      // beside this form carries it too, so a third copy inside a heading row
      // was three routes to the same screen on one page.
    >
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="handle" className="block font-display text-sm">
            Handle
          </label>

          <div className="flex items-stretch gap-0 rounded-brutal border-2 border-ink bg-paper shadow-brutal-sm focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ink">
            {/* The origin is shown as static text rather than baked into the
                input's value: it is not editable, and putting it in the field
                would let someone select and delete it. */}
            <span className="flex shrink-0 items-center py-2.5 pl-3 font-mono text-sm text-ink/70 select-none">
              /u/
            </span>
            <input
              id="handle"
              name="handle"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_HANDLE_LENGTH}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-invalid={Boolean(localProblem)}
              aria-describedby="handle-hint handle-error"
              // text-base, not text-sm: iOS Safari zooms the viewport when a
              // field under 16px takes focus, and does not zoom back out.
              className="w-full min-w-0 rounded-r-brutal bg-transparent py-2.5 pr-3 text-base font-medium focus:outline-none sm:text-sm"
            />
          </div>

          <p id="handle-hint" className="font-mono text-xs break-all text-ink/70">
            {`${origin}/u/${normalized || current}`}
          </p>

          {localProblem ? (
            <p id="handle-error" className="text-xs font-semibold">
              {localProblem}
            </p>
          ) : null}
        </div>

        {/* Stated before the change, not after. Someone who has already printed
            the old handle needs this at the moment they are deciding. */}
        <p className="rounded-brutal border-2 border-ink bg-lemon p-3 text-xs font-medium shadow-brutal-sm">
          Changing this keeps your old link working — it redirects here for 180
          days, and nobody else can take it in that time. You can change your
          handle twice every 90 days.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={pending || !changed || Boolean(localProblem)}
            className="rounded-full border-2 border-ink bg-lilac px-4 py-2.5 text-sm font-semibold shadow-brutal nb-press disabled:opacity-50"
          >
            {pending ? "Saving…" : "Change handle"}
          </button>

          {/* The fill carries the state so the text stays ink — a red string on
              a coral panel is the one combination this palette can't hold. */}
          {state.message ? (
            <p
              role="status"
              className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-semibold ${
                state.status === "error" ? "bg-coral" : "bg-lime"
              }`}
            >
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

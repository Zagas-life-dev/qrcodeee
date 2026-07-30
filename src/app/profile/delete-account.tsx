"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteAccount } from "@/lib/profile/delete-actions";

const CONFIRM_WORD = "delete";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  // The only panel in the app that sits on coral at rest. Nothing else is
  // allowed to, so the fill itself is the warning — this system has no red text
  // to carry it, and a paper panel with a red-bordered button would read as one
  // more row of the form above it.
  return (
    <section className="mt-12 rounded-brutal border-2 border-ink bg-coral p-4 shadow-brutal">
      <h2 className="font-display text-base">Delete your account</h2>

      {!open ? (
        <>
          <p className="mt-2 text-sm font-medium">
            Removes your photo, bio, phone, email and custom fields permanently.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 min-h-11 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Delete account
          </button>
        </>
      ) : (
        <div className="mt-2">
          {/* Says what actually happens, including the parts people assume wrongly.
              §8 and §1 both matter here: connections deliberately survive as a
              placeholder, and contacts already saved to someone's phone are
              permanently out of reach. */}
          <ul className="space-y-1.5 text-sm font-medium">
            <li>• Your phone, email, bio, photo and custom fields are deleted.</li>
            <li>• Your QR code stops working immediately.</li>
            <li>• You won&apos;t be able to sign in again.</li>
            <li>
              • People you connected with keep the connection, shown as
              &ldquo;Deleted account&rdquo;. They can remove it themselves.
            </li>
            <li>
              • Anyone who already saved you to their phone&apos;s contacts keeps
              that. We can&apos;t reach into their address book.
            </li>
          </ul>

          <label htmlFor="confirm" className="mt-4 block text-sm font-medium">
            Type <span className="font-mono font-bold">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="confirm"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1.5 min-h-12 w-full max-w-48 rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium sm:text-sm"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isPending || typed.trim().toLowerCase() !== CONFIRM_WORD}
              onClick={() =>
                startTransition(async () => {
                  // On success this redirects and never returns, so anything
                  // that comes back is a failure.
                  const result = await deleteAccount();
                  toast.error(result.message);
                })
              }
              className="min-h-12 rounded-brutal border-2 border-ink bg-ink px-4 text-sm font-bold text-paper shadow-brutal-sm nb-press-sm disabled:opacity-40"
            >
              {isPending ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
              className="min-h-12 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

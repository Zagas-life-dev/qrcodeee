"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteAccount } from "@/lib/profile/delete-actions";

const CONFIRM_WORD = "delete";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <section className="mt-12 rounded-lg border border-red-500/30 p-4">
      <h2 className="text-sm font-semibold">Delete your account</h2>

      {!open ? (
        <>
          <p className="mt-1 text-sm opacity-70">
            Removes your photo, bio, phone, email and custom fields permanently.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-500 transition hover:bg-red-500/10"
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
          <ul className="space-y-1.5 text-sm opacity-80">
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

          <label htmlFor="confirm" className="mt-4 block text-sm">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="confirm"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1 w-full max-w-48 rounded-md border border-current/15 bg-transparent px-2.5 py-1.5 text-sm"
          />

          <div className="mt-4 flex items-center gap-2">
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
              className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-40"
            >
              {isPending ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
              className="rounded-md px-3 py-1.5 text-sm opacity-70 transition hover:bg-current/5 hover:opacity-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

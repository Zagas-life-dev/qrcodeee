"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  blockProfile,
  disconnect,
  reportProfile,
  type ActionResult,
} from "@/lib/connections/actions";
import type { ReportCategory } from "@/lib/supabase/database.types";

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "impersonation", label: "Impersonation" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "scam", label: "Scam or fraud" },
  { value: "other", label: "Something else" },
];

type Props = { connectionId: string; profileId: string; name: string };

export function ConnectionActions({ connectionId, profileId, name }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"disconnect" | "block" | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function close() {
    if (menuRef.current) menuRef.current.open = false;
    setConfirming(null);
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.message);
      close();
      router.refresh();
    });
  }

  return (
    <>
      {/* <details> rather than a custom popover: it gets keyboard support, focus
          behaviour and Escape-to-close from the platform for free. */}
      <details ref={menuRef} className="relative shrink-0">
        <summary
          className="cursor-pointer list-none rounded-md border border-current/15 px-2 py-1 text-xs opacity-70 transition hover:bg-current/5 hover:opacity-100 [&::-webkit-details-marker]:hidden"
          aria-label={`Actions for ${name}`}
        >
          •••
        </summary>

        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-current/15 bg-[var(--background)] p-1 shadow-lg">
          {confirming === "disconnect" ? (
            <Confirm
              // Says what actually happens, including the part users get wrong:
              // disconnecting cannot claw back a contact they already saved.
              question={`Disconnect from ${name}?`}
              detail="They stay in your phone's contacts — that's out of our reach. You can reconnect by scanning again."
              confirmLabel="Disconnect"
              pending={isPending}
              onCancel={() => setConfirming(null)}
              onConfirm={() => run(() => disconnect(connectionId))}
            />
          ) : confirming === "block" ? (
            <Confirm
              question={`Block ${name}?`}
              detail="You'll disappear from each other entirely and neither of you can reconnect. Your connection is kept, so unblocking restores it."
              confirmLabel="Block"
              destructive
              pending={isPending}
              onCancel={() => setConfirming(null)}
              onConfirm={() => run(() => blockProfile(profileId))}
            />
          ) : (
            <ul className="text-sm">
              <li>
                <MenuButton onClick={() => setConfirming("disconnect")}>Disconnect</MenuButton>
              </li>
              <li>
                <MenuButton onClick={() => setConfirming("block")}>Block</MenuButton>
              </li>
              <li>
                <MenuButton
                  onClick={() => {
                    close();
                    dialogRef.current?.showModal();
                  }}
                >
                  Report
                </MenuButton>
              </li>
            </ul>
          )}
        </div>
      </details>

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(28rem,92vw)] rounded-lg border border-current/15 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/50"
      >
        <form
          className="p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const category = data.get("category") as ReportCategory;
            const notes = String(data.get("notes") ?? "");
            startTransition(async () => {
              const result = await reportProfile(profileId, category, notes);
              if (result.ok) toast.success(result.message ?? "Report sent");
              else toast.error(result.message);
              dialogRef.current?.close();
            });
          }}
        >
          <h2 className="text-base font-semibold">Report {name}</h2>
          <p className="mt-1 text-sm opacity-70">
            A person reviews every report. Reporting doesn&apos;t block them —
            do that separately if you want them gone straight away.
          </p>

          <label className="mt-4 block text-sm font-medium" htmlFor="category">
            What&apos;s wrong?
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue="spam"
            className="mt-1 w-full rounded-md border border-current/15 bg-transparent px-2.5 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} className="bg-neutral-900 text-white">
                {c.label}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-sm font-medium" htmlFor="notes">
            Anything else? <span className="font-normal opacity-60">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={1000}
            className="mt-1 w-full rounded-md border border-current/15 bg-transparent px-2.5 py-2 text-sm"
          />

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-sm opacity-70 transition hover:bg-current/5 hover:opacity-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function MenuButton({
  onClick, children,
}: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded px-2.5 py-1.5 text-left transition hover:bg-current/5"
    >
      {children}
    </button>
  );
}

function Confirm({
  question, detail, confirmLabel, destructive, pending, onCancel, onConfirm,
}: {
  question: string;
  detail: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-2">
      <p className="text-sm font-medium">{question}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs opacity-70 transition hover:bg-current/5 hover:opacity-100"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={`rounded border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
            destructive
              ? "border-red-500/40 text-red-500 hover:bg-red-500/10"
              : "border-current/15 hover:bg-current/5"
          }`}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

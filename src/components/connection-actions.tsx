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

type Props = {
  connectionId: string;
  profileId: string;
  name: string;
  /**
   * `menu` (the default) is the ••• button a list row needs, where three
   * labelled buttons per row would bury the row's own content. `inline` lays
   * the same three out directly, for the detail page — a screen dedicated to
   * one person has the room, and hiding its only actions behind a menu on a
   * page with nothing else on it is a tap for nothing.
   */
  layout?: "menu" | "inline";
};

/**
 * Per-connection actions, as a bottom sheet.
 *
 * This was a <details> dropdown, which is a pointer pattern: a 224px panel
 * anchored to a 28px summary, opening downward off the bottom of the last row
 * in the list, with menu items barely half the minimum touch target. On a phone
 * it was reliably easier to hit the wrong row than the right item.
 *
 * A <dialog> keeps everything the <details> was chosen for — focus trapping,
 * Escape, inertness behind it, no z-index fights — because all of that is the
 * platform's, not the element's. What changes is that it can be a full-width
 * sheet at the bottom of the screen (see `nb-sheet`), where the items are
 * thumb-sized and anchored to the same edge every time regardless of which row
 * opened it.
 */
export function ConnectionActions({
  connectionId,
  profileId,
  name,
  layout = "menu",
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"disconnect" | "block" | null>(null);
  const menuRef = useRef<HTMLDialogElement>(null);
  const reportRef = useRef<HTMLDialogElement>(null);

  function closeMenu() {
    menuRef.current?.close();
    setConfirming(null);
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.message);
      closeMenu();
      router.refresh();
    });
  }

  return (
    <>
      {layout === "menu" ? (
        <button
          type="button"
          onClick={() => menuRef.current?.showModal()}
          aria-label={`Actions for ${name}`}
          aria-haspopup="dialog"
          className="flex size-11 shrink-0 items-center justify-center rounded-brutal border-2 border-ink bg-paper text-base font-bold shadow-brutal-sm nb-press-sm"
        >
          <span aria-hidden>•••</span>
        </button>
      ) : (
        // Same three actions, same confirm sheet — only the trigger differs.
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setConfirming("disconnect");
              menuRef.current?.showModal();
            }}
            className="min-h-12 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming("block");
              menuRef.current?.showModal();
            }}
            className="min-h-12 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Block
          </button>
          <button
            type="button"
            onClick={() => reportRef.current?.showModal()}
            className="min-h-12 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Report
          </button>
        </div>
      )}

      <Sheet ref={menuRef} onClose={() => setConfirming(null)}>
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
          <>
            <h2 className="px-1 pb-1 font-display text-lg leading-tight">{name}</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <MenuButton onClick={() => setConfirming("disconnect")}>
                  Disconnect
                </MenuButton>
              </li>
              <li>
                <MenuButton onClick={() => setConfirming("block")}>Block</MenuButton>
              </li>
              <li>
                <MenuButton
                  onClick={() => {
                    closeMenu();
                    reportRef.current?.showModal();
                  }}
                >
                  Report
                </MenuButton>
              </li>
            </ul>
            <button
              type="button"
              onClick={closeMenu}
              className="mt-4 min-h-12 w-full rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
            >
              Cancel
            </button>
          </>
        )}
      </Sheet>

      <Sheet ref={reportRef}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const category = data.get("category") as ReportCategory;
            const notes = String(data.get("notes") ?? "");
            startTransition(async () => {
              const result = await reportProfile(profileId, category, notes);
              if (result.ok) toast.success(result.message ?? "Report sent");
              else toast.error(result.message);
              reportRef.current?.close();
            });
          }}
        >
          <h2 className="font-display text-lg leading-none">Report {name}</h2>
          <p className="mt-2 text-sm font-medium">
            A person reviews every report. Reporting doesn&apos;t block them — do
            that separately if you want them gone straight away.
          </p>

          <label className="mt-4 block font-display text-sm" htmlFor="category">
            What&apos;s wrong?
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue="spam"
            className="mt-1.5 min-h-12 w-full rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium shadow-brutal-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} className="bg-paper text-ink">
                {c.label}
              </option>
            ))}
          </select>

          <label className="mt-4 block font-display text-sm" htmlFor="notes">
            Anything else? <span className="font-sans font-medium">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={1000}
            className="mt-1.5 w-full rounded-brutal border-2 border-ink bg-paper px-3 py-2.5 text-base font-medium shadow-brutal-sm"
          />

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => reportRef.current?.close()}
              className="min-h-12 flex-1 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="min-h-12 flex-1 rounded-brutal border-2 border-ink bg-lemon px-4 text-sm font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

/**
 * The shared sheet shell.
 *
 * The click handler is the tap-outside-to-close that <dialog> does not give you:
 * a click landing on the backdrop reports the dialog itself as its target, which
 * only holds because the padding lives on the inner wrapper rather than on the
 * dialog — pad the dialog and its own padding becomes part of the target,
 * closing the sheet when someone taps just inside its edge.
 */
function Sheet({
  ref,
  onClose,
  children,
}: {
  ref: React.RefObject<HTMLDialogElement | null>;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="nb-sheet"
    >
      <div aria-hidden className="nb-grabber sm:hidden" />
      <div className="p-4 pb-6 sm:p-5">{children}</div>
    </dialog>
  );
}

function MenuButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-12 w-full rounded-brutal border-2 border-ink bg-paper px-4 text-left text-sm font-bold shadow-brutal-sm nb-press-sm"
    >
      {children}
    </button>
  );
}

function Confirm({
  question,
  detail,
  confirmLabel,
  destructive,
  pending,
  onCancel,
  onConfirm,
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
    <div>
      <p className="font-display text-base leading-tight">{question}</p>
      <p className="mt-2 text-sm font-medium">{detail}</p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 flex-1 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
        >
          Cancel
        </button>
        {/* Block is the destructive one and it gets the coral fill. Disconnect
            is reversible by rescanning, so it stays on paper — the two used to
            differ only by a border tint, which is not a difference in this
            system. */}
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={`min-h-12 flex-1 rounded-brutal border-2 border-ink px-4 text-sm font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50 ${
            destructive ? "bg-coral" : "bg-paper"
          }`}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

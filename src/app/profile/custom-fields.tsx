"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addCustomField,
  deleteCustomField,
  reorderCustomFields,
  updateCustomField,
} from "@/lib/profile/custom-field-actions";
import { Notice, Pill, Section } from "@/components/page";
import {
  MAX_CUSTOM_FIELDS,
  MAX_LABEL_LENGTH,
  MAX_VALUE_LENGTH,
} from "@/lib/profile/custom-field-limits";

export type CustomField = {
  id: string;
  label: string;
  value: string | null;
  is_public: boolean;
};

export function CustomFields({ fields }: { fields: CustomField[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local order so a reorder feels instant; the server is the source of truth
  // and router.refresh() reconciles.
  const [order, setOrder] = useState(fields);
  const [drafts, setDrafts] = useState<Record<string, { label: string; value: string }>>({});

  // `fields` changing identity means the server sent new data — adopt it.
  const [lastFields, setLastFields] = useState(fields);
  if (fields !== lastFields) {
    setLastFields(fields);
    setOrder(fields);
    setDrafts({});
  }

  const atLimit = order.length >= MAX_CUSTOM_FIELDS;

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Something went wrong.");
      else router.refresh();
    });
  }

  function draftOf(field: CustomField) {
    return drafts[field.id] ?? { label: field.label, value: field.value ?? "" };
  }

  function isDirty(field: CustomField) {
    const draft = drafts[field.id];
    if (!draft) return false;
    return draft.label !== field.label || draft.value !== (field.value ?? "");
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    run(() => reorderCustomFields(next.map((f) => f.id)));
  }

  return (
    <Section
      title="Custom fields"
      description="Anything else worth sharing — LinkedIn, company, job title. Each one can be public or kept private to you."
      action={
        <Pill className="tabular-nums">
          {order.length} of {MAX_CUSTOM_FIELDS}
        </Pill>
      }
    >
      {error ? (
        <Notice tone="error" role="alert" className="mb-4">
          {error}
        </Notice>
      ) : null}

      <ul className="space-y-3">
        {order.map((field, index) => {
          const draft = draftOf(field);
          const dirty = isDirty(field);

          return (
            <li
              key={field.id}
              className="rounded-brutal border-2 border-ink bg-paper p-3 shadow-brutal"
            >
              <div className="flex items-start gap-2">
                <div className="flex shrink-0 flex-col gap-1.5">
                  <ArrowButton
                    label={`Move ${field.label} up`}
                    disabled={index === 0 || isPending}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </ArrowButton>
                  <ArrowButton
                    label={`Move ${field.label} down`}
                    disabled={index === order.length - 1 || isPending}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </ArrowButton>
                </div>

                <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                  <input
                    aria-label="Label"
                    value={draft.label}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [field.id]: { ...draft, label: e.target.value } })
                    }
                    className="min-h-11 min-w-0 rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium sm:text-sm"
                  />
                  <input
                    aria-label="Value"
                    value={draft.value}
                    maxLength={MAX_VALUE_LENGTH}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [field.id]: { ...draft, value: e.target.value } })
                    }
                    className="min-h-11 min-w-0 rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium sm:text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Toggling saves the row's current text too, so a pending edit
                    can't be silently discarded by flipping visibility. */}
                {/* The fill swaps with the state as well as the word, so the
                    two visibility modes are distinguishable at a glance down a
                    list of eight rows rather than only by reading each one. */}
                <button
                  type="button"
                  disabled={isPending}
                  aria-pressed={field.is_public}
                  onClick={() =>
                    run(() =>
                      updateCustomField(field.id, draft.label, draft.value, !field.is_public),
                    )
                  }
                  className={`min-h-9 rounded-full border-2 border-ink px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50 ${
                    field.is_public ? "bg-lime" : "bg-paper"
                  }`}
                >
                  {field.is_public ? "Public" : "Private"}
                </button>

                <span className="text-xs font-medium text-ink/70">
                  {field.is_public
                    ? "Visible to anyone who opens your profile"
                    : "Only visible to you"}
                </span>

                <div className="ml-auto flex items-center gap-2">
                  {dirty ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        run(() =>
                          updateCustomField(field.id, draft.label, draft.value, field.is_public),
                        )
                      }
                      className="min-h-9 rounded-brutal border-2 border-ink bg-lemon px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
                    >
                      Save
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => deleteCustomField(field.id))}
                    className="min-h-9 rounded-brutal border-2 border-ink bg-paper px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm hover:bg-coral disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <AddField
        disabled={isPending || atLimit}
        atLimit={atLimit}
        onAdd={(label, value, isPublic) => run(() => addCustomField(label, value, isPublic))}
      />
    </Section>
  );
}

function ArrowButton({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // Stacked pairs of tiny arrows are the single easiest control to mis-tap
      // on a phone; size-9 with a gap between them is the floor that stops the
      // "move up" hitting "move down".
      className="flex size-9 items-center justify-center rounded-md border-2 border-ink bg-paper text-xs font-bold transition-colors hover:bg-lemon disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function AddField({
  disabled, atLimit, onAdd,
}: {
  disabled: boolean;
  atLimit: boolean;
  onAdd: (label: string, value: string, isPublic: boolean) => void;
}) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  if (atLimit) {
    return (
      <p className="mt-4 rounded-brutal border-2 border-dashed border-ink px-3 py-4 text-sm font-bold">
        You&apos;ve reached the limit of {MAX_CUSTOM_FIELDS} custom fields.
        Delete one to add another.
      </p>
    );
  }

  return (
    <form
      className="mt-4 rounded-brutal border-2 border-dashed border-ink p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) return;
        onAdd(label, value, isPublic);
        setLabel("");
        setValue("");
        setIsPublic(true);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <input
          aria-label="New field label"
          placeholder="LinkedIn"
          value={label}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(e) => setLabel(e.target.value)}
          className="min-h-11 min-w-0 rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium sm:text-sm"
        />
        <input
          aria-label="New field value"
          placeholder="linkedin.com/in/you"
          value={value}
          maxLength={MAX_VALUE_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-11 min-w-0 rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium sm:text-sm"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={isPublic}
          onClick={() => setIsPublic(!isPublic)}
          className={`min-h-9 rounded-full border-2 border-ink px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm ${
            isPublic ? "bg-lime" : "bg-paper"
          }`}
        >
          {isPublic ? "Public" : "Private"}
        </button>
        <button
          type="submit"
          disabled={disabled || !label.trim()}
          className="ml-auto min-h-11 rounded-brutal border-2 border-ink bg-lemon px-4 text-sm font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
        >
          Add field
        </button>
      </div>
    </form>
  );
}

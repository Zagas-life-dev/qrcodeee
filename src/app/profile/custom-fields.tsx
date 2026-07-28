"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addCustomField,
  deleteCustomField,
  reorderCustomFields,
  updateCustomField,
} from "@/lib/profile/custom-field-actions";
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
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Custom fields</h2>
        <span className="text-xs opacity-60">
          {order.length} of {MAX_CUSTOM_FIELDS}
        </span>
      </div>
      <p className="mt-1 text-sm opacity-70">
        Anything else worth sharing — LinkedIn, company, job title. Each one can
        be public or kept private to you.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {order.map((field, index) => {
          const draft = draftOf(field);
          const dirty = isDirty(field);

          return (
            <li key={field.id} className="rounded-lg border border-current/15 p-3">
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-1 pt-1">
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
                    className="rounded-md border border-current/15 bg-transparent px-2.5 py-1.5 text-sm"
                  />
                  <input
                    aria-label="Value"
                    value={draft.value}
                    maxLength={MAX_VALUE_LENGTH}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [field.id]: { ...draft, value: e.target.value } })
                    }
                    className="rounded-md border border-current/15 bg-transparent px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
                {/* Toggling saves the row's current text too, so a pending edit
                    can't be silently discarded by flipping visibility. */}
                <button
                  type="button"
                  disabled={isPending}
                  aria-pressed={field.is_public}
                  onClick={() =>
                    run(() =>
                      updateCustomField(field.id, draft.label, draft.value, !field.is_public),
                    )
                  }
                  className="rounded-full border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5 disabled:opacity-50"
                >
                  {field.is_public ? "Public" : "Private"}
                </button>

                <span className="text-xs opacity-50">
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
                      className="rounded-md border border-current/15 px-2.5 py-1 text-xs font-medium transition hover:bg-current/5 disabled:opacity-50"
                    >
                      Save
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => deleteCustomField(field.id))}
                    className="rounded-md px-2.5 py-1 text-xs opacity-70 transition hover:bg-red-500/10 hover:text-red-500 hover:opacity-100 disabled:opacity-40"
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
    </section>
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
      className="rounded border border-current/15 px-1.5 text-xs leading-5 transition hover:bg-current/5 disabled:opacity-25"
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
      <p className="mt-4 rounded-lg border border-dashed border-current/15 px-3 py-4 text-sm opacity-60">
        You&apos;ve reached the limit of {MAX_CUSTOM_FIELDS} custom fields.
        Delete one to add another.
      </p>
    );
  }

  return (
    <form
      className="mt-4 rounded-lg border border-dashed border-current/25 p-3"
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
          className="rounded-md border border-current/15 bg-transparent px-2.5 py-1.5 text-sm"
        />
        <input
          aria-label="New field value"
          placeholder="linkedin.com/in/you"
          value={value}
          maxLength={MAX_VALUE_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-md border border-current/15 bg-transparent px-2.5 py-1.5 text-sm"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={isPublic}
          onClick={() => setIsPublic(!isPublic)}
          className="rounded-full border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5"
        >
          {isPublic ? "Public" : "Private"}
        </button>
        <button
          type="submit"
          disabled={disabled || !label.trim()}
          className="ml-auto rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
        >
          Add field
        </button>
      </div>
    </form>
  );
}

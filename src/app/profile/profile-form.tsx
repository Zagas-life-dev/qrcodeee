"use client";

import { useActionState } from "react";

import { updateProfile, type ProfileFormState } from "@/lib/profile/actions";

const INITIAL: ProfileFormState = { status: "idle" };

type Props = {
  name: string;
  bio: string | null;
  phone: string | null;
  email: string | null;
};

export function ProfileForm({ name, bio, phone, email }: Props) {
  const [state, formAction, pending] = useActionState(updateProfile, INITIAL);

  return (
    <form action={formAction} className="mt-8 space-y-6">
      <Field
        label="Name"
        name="name"
        defaultValue={name}
        maxLength={100}
        required
        error={state.fieldErrors?.name}
        hint="Shown to everyone. Always public."
      />

      <Field
        label="Bio"
        name="bio"
        defaultValue={bio ?? ""}
        maxLength={500}
        multiline
        error={state.fieldErrors?.bio}
        hint="Always public."
      />

      <fieldset className="space-y-6 rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
        <legend className="rounded-full border-2 border-ink bg-sky px-3 py-0.5 font-display text-xs tracking-wide uppercase">
          Contact details
        </legend>
        <p className="text-sm font-medium">
          Only people you&apos;ve connected with can see these. They&apos;re
          hidden from everyone else, including anyone who just opens your
          profile.
        </p>

        <Field
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={phone ?? ""}
          maxLength={40}
          error={state.fieldErrors?.phone}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={email ?? ""}
          maxLength={320}
          error={state.fieldErrors?.email}
          hint="Not filled in from your Google account — add it only if you want connections to have it."
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border-2 border-ink bg-lilac px-4 py-2.5 text-sm font-semibold shadow-brutal nb-press disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>

        {/* The error fill carries the state, so the text stays ink — a red
            string on a coral panel is the one combination this palette can't
            hold. */}
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
  );
}

function Field({
  label,
  name,
  defaultValue,
  error,
  hint,
  multiline,
  ...rest
}: {
  label: string;
  name: string;
  defaultValue: string;
  error?: string;
  hint?: string;
  multiline?: boolean;
  type?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`]
    .filter(Boolean)
    .join(" ");

  const shared = {
    id: name,
    name,
    defaultValue,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy || undefined,
    // An invalid field takes the coral fill rather than a red border: against a
    // 2px ink outline a colour-shifted border is close to invisible, and the
    // fill is the only channel loud enough to read as "this one".
    // text-base, not text-sm: iOS Safari zooms the whole viewport when a field
    // under 16px takes focus, and it does not zoom back out. On the QR and scan
    // screens that leaves a fixed-size target mid-scroll at the wrong scale.
    className:
      "w-full rounded-brutal border-2 border-ink bg-paper px-3 py-2.5 text-base font-medium shadow-brutal-sm aria-invalid:bg-coral sm:text-sm",
    ...rest,
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block font-display text-sm">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} />
      )}
      {hint ? (
        <p id={`${name}-hint`} className="text-xs font-medium text-ink/70">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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

      <fieldset className="space-y-6 rounded-lg border border-current/15 p-4">
        <legend className="px-2 text-xs font-medium uppercase tracking-wide opacity-60">
          Contact details
        </legend>
        <p className="text-sm opacity-70">
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

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-current/15 px-4 py-2 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>

        {state.message ? (
          <p
            role="status"
            className={`text-sm ${state.status === "error" ? "text-red-500" : "opacity-70"}`}
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
    className:
      "w-full rounded-md border border-current/15 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 aria-invalid:border-red-500",
    ...rest,
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} />
      )}
      {hint ? (
        <p id={`${name}-hint`} className="text-xs opacity-60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

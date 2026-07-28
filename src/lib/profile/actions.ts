"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { triggerFanOut } from "@/lib/notifications/trigger";

type FieldName = "name" | "bio" | "phone" | "email";

export type ProfileFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<FieldName, string>>;
};

/**
 * CR/LF is rejected here for the same reason the DB rejects it (§3): these
 * values are interpolated into a generated .vcf, which is a line-based format,
 * so an embedded newline injects properties into a file every connection saves
 * to their address book. This is the outermost of three layers — escaping at
 * vCard generation time (§5.2) is the one that actually makes the output
 * well-formed, and the CHECK constraints are the backstop if either is bypassed.
 */
const NEWLINE = /[\r\n]/;

/** Deliberately permissive — real validation is the confirmation email we don't send. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalise(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Saves the whole profile in one operation rather than one request per field
 * (§5.3) — per-field saves would turn editing three fields into three change
 * events, and three notification fan-outs.
 *
 * This still issues two statements, because public identity lives on `profiles`
 * and connection-gated contact details live on `contact_details` (§4). That is
 * the floor given the table split, and it costs nothing: the worker batches all
 * unprocessed events for a profile into a single notification (§5.4).
 */
export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Your session expired. Sign in again." };
  }

  const name = normalise(formData.get("name"));
  const bio = normalise(formData.get("bio"));
  const phone = normalise(formData.get("phone"));
  const email = normalise(formData.get("email"));

  const fieldErrors: Partial<Record<FieldName, string>> = {};

  if (name.length === 0) {
    fieldErrors.name = "Add a name — this is what people see when they connect.";
  } else if (name.length > 100) {
    fieldErrors.name = "Keep your name under 100 characters.";
  } else if (NEWLINE.test(name)) {
    fieldErrors.name = "Names can't contain line breaks.";
  }

  if (bio.length > 500) fieldErrors.bio = "Keep your bio under 500 characters.";

  if (phone.length > 40) {
    fieldErrors.phone = "That phone number is too long.";
  } else if (NEWLINE.test(phone)) {
    fieldErrors.phone = "Phone numbers can't contain line breaks.";
  }

  if (email.length > 320) {
    fieldErrors.email = "That email address is too long.";
  } else if (NEWLINE.test(email)) {
    fieldErrors.email = "Email addresses can't contain line breaks.";
  } else if (email.length > 0 && !EMAIL_SHAPE.test(email)) {
    fieldErrors.email = "That doesn't look like an email address.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors, message: "Check the fields below." };
  }

  // RLS scopes this to the caller's own row, and the column grants in §4 mean
  // only name/photo_url/bio/qr_style are writable at all — so there is no way to
  // reach profile_version, qr_token or deleted_at from here even if this filter
  // were wrong.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ name, bio: bio || null })
    .eq("id", user.id);

  if (profileError) {
    return { status: "error", message: describe(profileError.code) };
  }

  const { error: contactError } = await supabase
    .from("contact_details")
    .upsert({ profile_id: user.id, phone: phone || null, email: email || null });

  if (contactError) {
    return { status: "error", message: describe(contactError.code) };
  }

  // Fan out now rather than waiting for the cron. On Vercel Hobby that wait is
  // up to 24 hours; here the connection hears about a changed phone number in
  // about a second.
  triggerFanOut(user.id);

  revalidatePath("/profile");
  return { status: "success", message: "Profile saved." };
}

/**
 * Never surface raw Postgres/RLS error text to a user (§5.5) — it's noise at
 * best and a schema disclosure at worst. Map to something actionable instead.
 */
function describe(code: string | undefined): string {
  switch (code) {
    case "23514": // check_violation
      return "One of those values isn't allowed. Check the lengths and try again.";
    case "23505": // unique_violation
      return "That value is already in use.";
    case "42501": // insufficient_privilege — an RLS denial
      return "You don't have permission to change that.";
    case "53400": // the §7 profile-mutation rate limit
      return "You've made a lot of changes recently. Try again in a little while.";
    default:
      return "Couldn't save your profile. Please try again.";
  }
}

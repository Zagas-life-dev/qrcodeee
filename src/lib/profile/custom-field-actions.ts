"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { triggerFanOut } from "@/lib/notifications/trigger";
import {
  MAX_CUSTOM_FIELDS,
  MAX_LABEL_LENGTH,
  MAX_VALUE_LENGTH,
} from "@/lib/profile/custom-field-limits";

export type FieldResult =
  | { ok: true }
  | { ok: false; message: string };

const NEWLINE = /[\r\n]/;

/**
 * Custom field labels and values are free text by design, and §5.2 singles them
 * out as the most dangerous vCard inputs for exactly that reason. Same CR/LF ban
 * as name/phone/email — the escaping in the vCard generator is what makes the
 * output well-formed, this stops the bad value being stored in the first place.
 */
function validate(label: string, value: string): string | null {
  if (label.length === 0) return "Give the field a label.";
  if (label.length > MAX_LABEL_LENGTH) return `Labels are limited to ${MAX_LABEL_LENGTH} characters.`;
  if (NEWLINE.test(label)) return "Labels can't contain line breaks.";
  if (value.length > MAX_VALUE_LENGTH) return `Values are limited to ${MAX_VALUE_LENGTH} characters.`;
  if (NEWLINE.test(value)) return "Values can't contain line breaks.";
  return null;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Postgres error codes -> copy. The 23514 case is the max-field trigger, which
 * raises with errcode check_violation; 23505 is the case-insensitive unique
 * index on (profile_id, lower(label)).
 */
function describe(code: string | undefined, fallback: string): string {
  switch (code) {
    case "23505":
      return "You already have a field with that label.";
    case "23514":
      return `You've reached the limit of ${MAX_CUSTOM_FIELDS} custom fields.`;
    case "42501":
      return "You don't have permission to change that.";
    case "53400": // the §7 profile-mutation rate limit
      return "You've made a lot of changes recently. Try again in a little while.";
    default:
      return fallback;
  }
}

export async function addCustomField(
  label: string,
  value: string,
  isPublic: boolean,
): Promise<FieldResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const trimmedLabel = label.trim();
  const trimmedValue = value.trim();
  const invalid = validate(trimmedLabel, trimmedValue);
  if (invalid) return { ok: false, message: invalid };

  // Append to the end. Reading max(sort_order) rather than counting rows means
  // deleting a middle field doesn't cause the next insert to collide.
  const { data: last } = await supabase
    .from("custom_fields")
    .select("sort_order")
    .eq("profile_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("custom_fields").insert({
    profile_id: user.id,
    label: trimmedLabel,
    value: trimmedValue || null,
    is_public: isPublic,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) return { ok: false, message: describe(error.code, "Couldn't add that field.") };

  triggerFanOut(user.id);
  revalidatePath("/profile");
  return { ok: true };
}

export async function updateCustomField(
  id: string,
  label: string,
  value: string,
  isPublic: boolean,
): Promise<FieldResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const trimmedLabel = label.trim();
  const trimmedValue = value.trim();
  const invalid = validate(trimmedLabel, trimmedValue);
  if (invalid) return { ok: false, message: invalid };

  // The profile_id filter is redundant against the RLS policy, which already
  // scopes this to the owner — kept because an id alone reads like an
  // authorization decision, and it shouldn't.
  const { error } = await supabase
    .from("custom_fields")
    .update({ label: trimmedLabel, value: trimmedValue || null, is_public: isPublic })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { ok: false, message: describe(error.code, "Couldn't save that field.") };

  triggerFanOut(user.id);
  revalidatePath("/profile");
  return { ok: true };
}

export async function deleteCustomField(id: string): Promise<FieldResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { error } = await supabase
    .from("custom_fields")
    .delete()
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { ok: false, message: describe(error.code, "Couldn't delete that field.") };

  triggerFanOut(user.id);
  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Persists a new order as one statement (see the RPC in the migration).
 *
 * Only sort_order is written, which is what keeps a reorder free of change
 * events (§5.4) — connections are not notified that you dragged a row.
 */
export async function reorderCustomFields(orderedIds: string[]): Promise<FieldResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { error } = await supabase.rpc("reorder_custom_fields", { field_ids: orderedIds });
  if (error) return { ok: false, message: describe(error.code, "Couldn't save the new order.") };

  // Deliberately NO triggerFanOut here. Reordering writes only sort_order, which
  // produces no change event by design (§5.4) — there is nothing to fan out, and
  // firing the worker would just take the advisory lock for no reason.
  revalidatePath("/profile");
  return { ok: true };
}

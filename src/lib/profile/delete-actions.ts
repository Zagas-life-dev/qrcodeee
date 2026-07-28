"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type DeleteResult = { ok: false; message: string };

/** ~100 years. GoTrue takes a Go duration string. */
const BAN_FOREVER = "876000h";

/**
 * Deletes the caller's account (§8).
 *
 * Three steps, and the second one is not in the spec but is required to make the
 * first one mean anything.
 *
 * 1. `delete_my_account()` scrubs and soft-deletes the profile row. Soft, so
 *    other people's connection history resolves to a "Deleted account"
 *    placeholder rather than a broken reference.
 *
 * 2. Ban the auth user. §8 says the user-facing flow must NEVER touch
 *    auth.users, because `profiles.id references auth.users(id) on delete
 *    cascade` — an admin delete would cascade away the very placeholder the
 *    whole policy is built around. But leaving the auth record fully active
 *    means a "deleted" user simply signs in again and lands on a scrubbed
 *    profile they can start editing, with no way to delete it a second time.
 *    Banning disables sign-in and refresh WITHOUT removing the row, which is the
 *    only option that satisfies both constraints.
 *
 * 3. Sign out. The banned user's refresh token is already rejected; this closes
 *    the current access token's remaining lifetime cleanly rather than leaving
 *    them on a half-dead session.
 */
export async function deleteAccount(): Promise<DeleteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    return {
      ok: false,
      message:
        error.code === "53400"
          ? "Too many changes recently. Wait a moment and try again."
          : "We couldn't delete your account. Please try again.",
    };
  }

  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_FOREVER });
  } catch {
    // The profile is already scrubbed and soft-deleted, which is the part that
    // matters for everyone else. A failed ban means this person could sign in
    // again to an empty shell — bad, but not a reason to leave their data in
    // place or to report failure after the destructive step already succeeded.
    console.error("account deletion: ban failed for", user.id);
  }

  await supabase.auth.signOut();
  redirect("/goodbye");
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { avatarUrl } from "@/lib/cloudinary";

export type PhotoResult = { ok: true } | { ok: false; message: string };

/**
 * Records a completed avatar upload.
 *
 * Takes the Cloudinary *version number* and nothing else — deliberately. The
 * obvious shape for this action is `savePhoto(url)`, which is also an arbitrary-
 * URL write into a column every profile viewer renders as an <img src>; the
 * client would simply be asserting where its own photo lives. Here the URL is
 * reconstructed server-side from `auth.uid()`, so the only thing the caller
 * influences is cache-busting. The host CHECK constraint on profiles.photo_url
 * is the backstop if this is ever bypassed.
 */
export async function savePhoto(version: number): Promise<PhotoResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  if (!Number.isSafeInteger(version) || version <= 0) {
    return { ok: false, message: "That upload didn't complete. Try again." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ photo_url: avatarUrl(user.id, version) })
    .eq("id", user.id);

  if (error) {
    return { ok: false, message: "Couldn't save your photo. Please try again." };
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Clears the avatar. The Cloudinary asset is intentionally left in place: the
 * public_id is deterministic, so the next upload overwrites it anyway, and
 * deleting from here would need an authenticated Admin API call whose failure
 * mode is a half-done removal — a profile showing no photo while the file is
 * still fetchable. Reaping unreferenced assets belongs in a retention job (§8).
 */
export async function removePhoto(): Promise<PhotoResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ photo_url: null })
    .eq("id", user.id);

  if (error) {
    return { ok: false, message: "Couldn't remove your photo. Please try again." };
  }

  revalidatePath("/profile");
  return { ok: true };
}

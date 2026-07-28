"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { normalizeQrStyle, type QrStyle } from "@/lib/qr/style";

export type QrResult =
  | { ok: true; token?: string }
  | { ok: false; message: string };

/**
 * Persists a QR style. Normalised server-side rather than trusting the client
 * payload — `qr_style` is jsonb with only a size cap, so without this a scripted
 * client could store anything and every later render would have to defend
 * against it.
 *
 * Writing qr_style does NOT bump profile_version (§5.4 table): restyling your
 * own QR code changes nothing about the contact details anyone saved, so nobody
 * should be notified. That's enforced by the WHEN clause on
 * profiles_bump_version, not here.
 */
export async function saveQrStyle(style: QrStyle): Promise<QrResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ qr_style: normalizeQrStyle(style) })
    .eq("id", user.id);

  if (error) {
    return {
      ok: false,
      message:
        error.code === "23514"
          ? "That style is too large to save."
          : "Couldn't save your QR style. Please try again.",
    };
  }

  revalidatePath("/qr");
  return { ok: true };
}

/**
 * Rotates the QR token (§6). Goes through the SECURITY DEFINER RPC because
 * qr_token is deliberately outside the column grants — a client that could write
 * it directly could choose it, and a chosen token is a guessable one.
 *
 * Worth surfacing in the UI: this invalidates printed codes but does NOT break
 * existing connections, which reference profiles.id rather than the token.
 */
export async function rotateToken(): Promise<QrResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { data, error } = await supabase.rpc("rotate_qr_token");
  if (error?.code === "53400") {
    return {
      ok: false,
      message: "You've reset your code several times recently. Try again in an hour.",
    };
  }
  if (error || typeof data !== "string") {
    return { ok: false, message: "Couldn't reset your QR code. Please try again." };
  }

  revalidatePath("/qr");
  return { ok: true, token: data };
}

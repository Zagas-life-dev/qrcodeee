"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { normalizeQrStyle, type QrStyle } from "@/lib/qr/style";

import type { MintedQrToken } from "@/lib/supabase/database.types";

export type QrResult =
  | { ok: true; token?: string }
  | { ok: false; message: string };

export type MintResult =
  | { ok: true; token: string; expiresAt: string }
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
 * Returns the caller's live QR token, minting one if the current has expired
 * (§6). Called on render and again by the client just before expiry, so the
 * displayed code is never one a scanner can arrive too late for.
 *
 * No revalidatePath: this is polled on a timer, and busting the route cache
 * every fifteen minutes for a value the client already holds would re-render
 * the page underneath the user mid-edit.
 */
export async function mintQrToken(): Promise<MintResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  const { data, error } = await supabase.rpc("mint_qr_token");
  if (error?.code === "53400") {
    return {
      ok: false,
      message: "Your code has been refreshed a lot recently. Try again shortly.",
    };
  }
  const minted = data as MintedQrToken | null;
  if (error || !minted?.token) {
    return { ok: false, message: "Couldn't generate your QR code. Please try again." };
  }

  return { ok: true, token: minted.token, expiresAt: minted.expires_at };
}

/**
 * Kills every outstanding code for this user and returns a fresh one (§6).
 *
 * Codes now expire on their own, so this is about IMMEDIACY: someone who has
 * just realised their screen was photographed should not have to wait out the
 * remaining fifteen minutes. It deletes tokens on other devices too, which is
 * the case worth catching.
 *
 * Still does NOT break existing connections — those reference profiles.id, never
 * a token.
 */
export async function rotateToken(): Promise<MintResult> {
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
  const minted = data as MintedQrToken | null;
  if (error || !minted?.token) {
    return { ok: false, message: "Couldn't reset your QR code. Please try again." };
  }

  revalidatePath("/qr");
  return { ok: true, token: minted.token, expiresAt: minted.expires_at };
}

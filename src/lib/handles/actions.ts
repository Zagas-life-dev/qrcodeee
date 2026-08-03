"use server";

import { revalidatePath, updateTag } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { SetHandleResult } from "@/lib/supabase/database.types";

import { handleProblem, normalizeHandle } from "./format";

export type HandleFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** The handle now in effect, so the form can re-render against the truth. */
  handle?: string;
};

/**
 * Changes the caller's handle (site-spec S3).
 *
 * Thin on purpose: every rule that matters — the reserved list, the parking of
 * the outgoing handle in handle_history, the hold window, the 2-per-90-days
 * limit — lives inside `set_handle()`, where it is enforced for any caller
 * rather than for callers who happen to come through this action. What this adds
 * is normalisation, an early reject with a specific reason, and translation of
 * a status code into something a person can act on.
 */
export async function updateHandle(
  _prev: HandleFormState,
  formData: FormData,
): Promise<HandleFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Your session expired. Sign in again." };
  }

  const raw = formData.get("handle");
  const wanted = normalizeHandle(typeof raw === "string" ? raw : "");

  // Checked here as well as in the RPC so a malformed handle never spends one of
  // the caller's two changes per 90 days finding out it was malformed.
  const problem = handleProblem(wanted);
  if (problem) return { status: "error", message: problem };

  const { data, error } = await supabase.rpc("set_handle", { p_handle: wanted });

  if (error) {
    return { status: "error", message: "Couldn't change your handle. Please try again." };
  }

  const result = data as SetHandleResult;

  switch (result.status) {
    case "ok":
      // The NEW handle may already have a cached `not_found` from someone who
      // guessed at it before it was claimed, so it needs clearing by name.
      updateTag(`handle:${result.handle}`);
      // The OLD handle's entry is cleared by this without the action ever
      // having to learn what it was: that entry resolved as `found`, so
      // resolveHandle tagged it with this profile's id. It re-resolves to
      // `moved` on the next request.
      updateTag(`profile:${user.id}`);

      revalidatePath("/profile");
      revalidatePath(`/u/${result.handle}`);
      return {
        status: "success",
        message: "Handle updated. Your old link now redirects here.",
        handle: result.handle,
      };

    case "taken":
      return { status: "error", message: "That handle is already taken. Try another." };

    case "reserved":
      // Kept distinct from "taken": "reserved" tells someone to think of a
      // different name, where "taken" invites them to try ada1, ada2, ada3.
      return { status: "error", message: "That handle is reserved. Pick a different one." };

    case "invalid":
      return { status: "error", message: "That handle isn't allowed." };

    case "rate_limited":
      return {
        status: "error",
        message:
          "You can change your handle twice every 90 days. Your old links keep working in the meantime.",
      };

    case "unauthenticated":
      return { status: "error", message: "Your session expired. Sign in again." };

    case "not_found":
      return { status: "error", message: "We couldn't find your profile." };
  }
}

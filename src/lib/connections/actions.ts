"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { ReportCategory } from "@/lib/supabase/database.types";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const EXPIRED = { ok: false, message: "Your session expired. Sign in again." } as const;

/**
 * Soft-disconnects (§5.6). The connection row survives — it is the audit trail,
 * and a later scan reactivates the same row rather than inserting a new one
 * (§5.1).
 */
export async function disconnect(connectionId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return EXPIRED;

  const { data, error } = await supabase.rpc("disconnect_connection", {
    p_connection_id: connectionId,
  });

  if (error) return { ok: false, message: "Couldn't disconnect. Please try again." };
  if (data !== true) {
    // The RPC returns false for not-found / not-yours / already-disconnected
    // without distinguishing them, so this message can't be specific either.
    return { ok: false, message: "That connection is no longer active." };
  }

  revalidatePath("/connections");
  return { ok: true, message: "Disconnected." };
}

/**
 * Blocks, bidirectionally and immediately (§5.6).
 *
 * A plain insert: the §4 policy already scopes `blocks` to the caller, and there
 * is nothing elevated to do. Deliberately does NOT disconnect — §5.6 keeps the
 * connection row so history survives if the block is ever reversed. The RLS
 * policies simply exclude it from every read path while the block stands.
 */
export async function blockProfile(profileId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return EXPIRED;

  const { error } = await supabase
    .from("blocks")
    .insert({ blocker_id: user.id, blocked_id: profileId });

  if (error) {
    if (error.code === "23505") return { ok: true, message: "Already blocked." };
    if (error.code === "23514") return { ok: false, message: "You can't block yourself." };
    return { ok: false, message: "Couldn't block that person. Please try again." };
  }

  revalidatePath("/connections");
  revalidatePath("/blocked");
  return { ok: true, message: "Blocked. They can no longer see you or reconnect." };
}

export async function unblockProfile(profileId: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return EXPIRED;

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", profileId);

  if (error) return { ok: false, message: "Couldn't unblock. Please try again." };

  revalidatePath("/connections");
  revalidatePath("/blocked");
  return { ok: true, message: "Unblocked." };
}

/**
 * Files a report for manual review (§5.6).
 *
 * The partial unique index on (reporter_id, reported_id) where resolved_at is
 * null stops someone piling reports onto the same target while a case is open,
 * without permanently barring a genuine new report years later.
 *
 * One honest caveat, straight from §5.6: nothing in this build sets
 * `resolved_at` — there is no moderation surface yet — so until a case is closed
 * by hand in the Supabase dashboard, that partial index behaves exactly like the
 * flat per-pair unique it replaced. Resolving by hand is a fine MVP answer;
 * having no answer would mean the re-report path silently doesn't exist.
 */
export async function reportProfile(
  profileId: string,
  category: ReportCategory,
  notes: string,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return EXPIRED;

  const trimmed = notes.trim();
  if (trimmed.length > 1000) {
    return { ok: false, message: "Please keep the details under 1000 characters." };
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    reported_id: profileId,
    category,
    notes: trimmed || null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "You already have an open report about this person. We're looking into it.",
      };
    }
    if (error.code === "23514") return { ok: false, message: "You can't report yourself." };
    if (error.code === "53400") {
      // §7 caps reports at 10/hour. The partial unique index stops piling onto
      // one target; this is what stops one account reporting 500 different
      // people.
      return {
        ok: false,
        message: "You've filed several reports recently. Try again in an hour.",
      };
    }
    return { ok: false, message: "Couldn't send that report. Please try again." };
  }

  return { ok: true, message: "Report sent. We'll review it." };
}

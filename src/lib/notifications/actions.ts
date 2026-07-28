"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Marks notifications read. The column grant in §4 restricts `authenticated` to
 * writing read_at and nothing else, so this cannot rewrite type,
 * source_profile_id or change_version even if the filter were wrong.
 */
export async function markRead(ids: string[]): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || ids.length === 0) return { ok: false };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) return { ok: false };

  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllRead(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) return { ok: false };

  revalidatePath("/notifications");
  return { ok: true };
}

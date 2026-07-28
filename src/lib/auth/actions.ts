"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { siteUrl } from "@/lib/site";

/**
 * Kicks off Google OAuth. The `next` path rides through the whole round trip so
 * a scan that arrives logged-out lands back on `/connect/<token>` afterwards
 * and completes the connection automatically (§5.1) — the user never scans twice.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=oauth_start&next=${encodeURIComponent(next)}`);
  }

  // Must be outside any try/catch: redirect() signals by throwing.
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability";
import { safeNextPath } from "@/lib/safe-redirect";
import { siteUrl } from "@/lib/site";

/**
 * Kicks off Google OAuth. The `next` path rides through the whole round trip so
 * a scan that arrives logged-out lands back on `/connect/<token>` afterwards
 * and completes the connection automatically (§5.1) — the user never scans twice.
 *
 * Nothing in here is allowed to throw past the action boundary. There is no
 * `error.tsx` in this tree, so an uncaught throw replaces the page with Next's
 * default crash screen and a bare digest — which is all a Vercel log shows if
 * the cause never got written down. A user who can't sign in should see the
 * sign-in page saying so, and an operator should see the reason.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());

  // Everything fallible happens in the try; both redirects live outside it,
  // because redirect() signals by throwing and a catch would swallow it.
  let authorizeUrl = "";
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) throw error;
    if (!data.url) throw new Error("Supabase returned no authorization URL.");
    authorizeUrl = data.url;
  } catch (cause) {
    // The two realistic causes look identical from the outside and need
    // opposite responses: a misconfigured deployment (siteUrl() throwing on an
    // unset NEXT_PUBLIC_SITE_URL) needs an operator, a Supabase blip needs
    // nothing but patience. Only the message tells them apart, so log it —
    // grep Vercel's runtime logs for `oauth_start_failed`.
    log.error("oauth_start_failed", {
      provider: "google",
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!authorizeUrl) {
    redirect(`/login?error=oauth_start&next=${encodeURIComponent(next)}`);
  }

  redirect(authorizeUrl);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

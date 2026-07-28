import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * OAuth callback. Exchanges the PKCE code for a session, then forwards to
 * wherever the user was originally headed — `/connect/<token>` for a scan that
 * arrived logged-out (§5.1), `/profile` otherwise.
 *
 * `next` is untrusted (it survives a full round trip through Google), so it goes
 * through safeNextPath before being used to build a redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    // Supabase puts the reason here when the provider itself rejected the flow.
    const reason = searchParams.get("error_description") ?? searchParams.get("error");
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}

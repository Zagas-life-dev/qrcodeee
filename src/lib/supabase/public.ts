import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Anon-key client with NO session attached — the `anon` role, always, for every
 * caller.
 *
 * This exists because `createClient()` in server.ts binds to the request's
 * cookies, which makes every read it performs a function of WHO IS ASKING. That
 * is correct for rendering a signed-in page and actively wrong for anything
 * whose result gets cached and shared: under `use cache` (site-spec S12) the
 * first viewer to miss the cache would decide what every subsequent viewer
 * sees, with their RLS evaluation baked in.
 *
 * So: reads inside a cached region use THIS client, and anything viewer-
 * dependent — contact details, connection state, the block check — is read with
 * the cookie-bound client outside that region. The split is the whole design of
 * the public profile page, not a micro-optimisation.
 *
 * Not the service-role client: this has no elevated privilege at all. RLS still
 * applies, evaluated as `anon`, which is exactly the audience a cached public
 * page is rendered for.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

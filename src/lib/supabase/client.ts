import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser-side Supabase client. Runs as the `authenticated` role (or `anon`
 * when logged out), so every query it makes is subject to the RLS policies in
 * §4 of the build spec. That is the intended and only permission model — there
 * is no app-level permission fallback.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

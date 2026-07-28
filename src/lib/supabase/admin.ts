import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role client. Bypasses RLS completely.
 *
 * Only two things in this product legitimately need it:
 *   - the background change-notification worker (§5.4), which reads
 *     `profile_change_events` (RLS on, zero policies) and writes `notifications`
 *   - retention / pruning jobs (§8)
 *
 * Never import this from a Client Component, and never reach for it to "just
 * make a query work" — a query that RLS rejects is telling you the policy or
 * the access pattern is wrong.
 *
 * Deliberately not a module-level singleton: touching the env var at import
 * time would throw during the client bundle's module graph analysis in some
 * setups. Call it inside the request/job that needs it.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This client is server-only.",
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

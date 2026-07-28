import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Server-side Supabase client bound to the caller's session cookies. Still the
 * `authenticated` role, so RLS applies exactly as it does in the browser — this
 * is for rendering, not for privileged work. Anything that needs to bypass RLS
 * goes through a SECURITY DEFINER RPC, or `createAdminClient()` in admin.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot write cookies.
            // Harmless as long as something upstream is refreshing the session
            // — something is, see src/proxy.ts.
          }
        },
      },
    },
  );
}

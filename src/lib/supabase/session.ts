import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * The current user, resolved at most once per request.
 *
 * `auth.getUser()` is a network round trip to the auth server — it revalidates
 * the token rather than trusting the cookie's contents, which is exactly why
 * this codebase uses it over `getSession()`. That makes it something worth
 * calling once and sharing.
 *
 * It became worth extracting when the app shell split into two Suspense
 * boundaries (app-shell.tsx): the header and the dock each need to know whether
 * anyone is signed in, and without this they would each pay for the answer.
 * React's `cache` dedupes across the whole render, including across separate
 * Suspense boundaries, so the split costs nothing.
 *
 * Reads cookies, so any component calling this is runtime data access — under
 * Cache Components that means it belongs inside a `<Suspense>` boundary and can
 * never appear inside a `use cache` scope.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

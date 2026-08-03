import { getSessionUser } from "@/lib/supabase/session";

import { ConnectionListener } from "./connection-listener";

/**
 * Mounts the Realtime listener for signed-in users only.
 *
 * Exists as a server component so the user id is resolved from the session
 * rather than passed down from a page — the listener subscribes to a
 * per-recipient channel, and it should never be possible to render it pointed at
 * someone else's id.
 *
 * Must be rendered inside a `<Suspense>` boundary: it reads the session, and
 * under Cache Components runtime data outside a boundary blocks the whole route
 * from prerendering. This sits in the root layout, so unboundaried it blocks
 * every page in the app — see the boundary in layout.tsx.
 */
export async function AppListeners() {
  const user = await getSessionUser();
  if (!user) return null;

  return <ConnectionListener userId={user.id} />;
}

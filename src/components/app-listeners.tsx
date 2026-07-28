import { createClient } from "@/lib/supabase/server";

import { ConnectionListener } from "./connection-listener";

/**
 * Mounts the Realtime listener for signed-in users only.
 *
 * Exists as a server component so the user id is resolved from the session
 * rather than passed down from a page — the listener subscribes to a
 * per-recipient channel, and it should never be possible to render it pointed at
 * someone else's id.
 */
export async function AppListeners() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return <ConnectionListener userId={user.id} />;
}

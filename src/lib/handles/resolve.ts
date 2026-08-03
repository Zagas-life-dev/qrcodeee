import { cacheLife, cacheTag } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import type { HandleResolution } from "@/lib/supabase/database.types";

export { normalizeHandle, isValidHandle, HANDLE_PATTERN } from "./format";

/**
 * The public profile page's only read (site-spec S3).
 *
 * CACHED, AND THE PRECONDITION FOR THAT IS THAT IT TAKES NOTHING BUT A HANDLE.
 * It reads through `createPublicClient()` — the `anon` role, no cookies — so its
 * result is identical for every visitor and can be shared. Reading the session
 * in here would be a correctness bug rather than a style one: the first viewer
 * to miss the cache would bake their own RLS evaluation into an entry served to
 * everyone after them. That is why the block check lives in the route instead.
 *
 * TWO TAGS, because two different things invalidate this:
 *   handle:{handle}  — the handle itself changed hands (set_handle), including
 *                      the entry that used to answer `not_found` for a name
 *                      nobody held yet.
 *   profile:{id}     — the person edited their name, photo or bio. The writer
 *                      knows their own id and does NOT know their handle, so
 *                      tagging by id is what lets updateProfile invalidate this
 *                      without a lookup.
 *
 * `cacheLife` is a backstop, not the mechanism — every write path revalidates
 * explicitly. It exists so a missed revalidation is a stale hour rather than a
 * permanently wrong page.
 *
 * A failure THROWS rather than degrading to `not_found`. Rendering a database
 * outage as "no such person" on a public page is the worse error by a distance:
 * it is a 404 where the honest answer is a 500, and a 404 is the one status a
 * crawler is happy to act on permanently.
 */
export async function resolveHandle(handle: string): Promise<HandleResolution> {
  "use cache";
  cacheTag(`handle:${handle}`);
  cacheLife("hours");

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("resolve_handle", { p_handle: handle });

  if (error) {
    throw new Error(`resolve_handle failed for "${handle}": ${error.message}`);
  }

  const resolution = data as HandleResolution;

  // Added after the fact because the id isn't known until the row comes back.
  // Only `found` carries one — a `moved` or `not_found` answer has no profile
  // whose edits could invalidate it, and `handle:` already covers those.
  if (resolution.status === "found") {
    cacheTag(`profile:${resolution.profile.id}`);
  }

  return resolution;
}

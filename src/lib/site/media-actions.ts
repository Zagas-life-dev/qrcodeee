"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { MAX_STORED_EDGE } from "@/lib/site/media";
import { isMediaId, type ImageRef } from "./blocks";

export type MediaResult =
  | { ok: true; ref: ImageRef }
  | { ok: false; message: string };

/**
 * Records a finished upload in the media ledger (site-spec S6).
 *
 * The upload itself went browser → Cloudinary; this is the callback that makes
 * it OURS. Two things depend on the row existing, and neither can be recovered
 * from block content: the per-account cap (`site_media_limit`), and the sweep
 * that deletes assets when an account is deleted. A public_id buried in a
 * block's JSONB is not something a cleanup query can find — which is why the
 * ledger is a table and not an inference.
 *
 * WHAT THIS DOES NOT DO IS VERIFY THE UPLOAD. Cloudinary's response goes to the
 * browser, so `version`, `width` and `height` are relayed by the client and
 * could be anything. Checking them would mean an Admin API round trip per
 * image, and the threat it would close is "a user lies about their own image's
 * aspect ratio and skews their own layout". The two values where a lie WOULD
 * matter are handled structurally instead: the media id is generated
 * server-side, and the folder is derived from `auth.uid()` — so a fabricated
 * row can only ever describe a slot inside the caller's own folder.
 *
 * `bytes` is deliberately not taken from the client at all. It would be the one
 * field a lie could profit from if a byte quota ever ships, and the incoming
 * `c_limit` transformation already bounds what Cloudinary stores.
 */
export async function recordSiteMedia(
  mediaId: string,
  version: number,
  width: number,
  height: number,
): Promise<MediaResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };

  if (!isMediaId(mediaId)) {
    return { ok: false, message: "That upload id isn't valid." };
  }
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, message: "That upload is missing its version." };
  }

  const clamp = (n: number) =>
    Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), MAX_STORED_EDGE * 4) : 1000;
  const w = clamp(width);
  const h = clamp(height);

  const supabase = await createClient();
  const { error } = await supabase.from("site_media").insert({
    profile_id: user.id,
    // The ledger stores the bare id, matching what blocks store. The Cloudinary
    // path is rebuilt from it and the profile id wherever it is needed, so
    // there is exactly one place that knows the folder layout.
    public_id: mediaId,
    version,
    width: w,
    height: h,
  });

  if (error) {
    // 53400 is the cap trigger. Everything else is genuinely unexpected and
    // must not leak a Postgres message into the editor.
    if (error.code === "53400") {
      return { ok: false, message: "You've reached the image limit for this account." };
    }
    return { ok: false, message: "Couldn't save that image. Try again." };
  }

  return { ok: true, ref: { id: mediaId, v: version, w, h, alt: "" } };
}

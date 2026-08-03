import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { signSiteMediaUpload } from "@/lib/cloudinary";

/**
 * Hands the browser a signature for one upload into its own media folder.
 *
 * As with the avatar route, the user id comes from the session and never from
 * the request — the folder is `.../user_${auth.uid()}/`, inside the signed
 * payload, so there is no argument a caller can supply to write somewhere else.
 * The media id is generated server-side too, which is the part that differs:
 * the client cannot pick, and therefore cannot re-pick, where its image lands.
 *
 * The body is empty by design. Nothing about the file — its name, type or size
 * — changes the signature, so there is nothing here to validate or to lie about.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    return NextResponse.json(signSiteMediaUpload(user.id));
  } catch {
    // Never echo the thrown message: it names the missing env vars.
    return NextResponse.json({ error: "Image uploads aren't configured." }, { status: 503 });
  }
}

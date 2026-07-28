import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { signAvatarUpload } from "@/lib/cloudinary";

/**
 * Hands the browser a signature scoped to the caller's own avatar slot.
 *
 * The user id comes from the session, never from the request body — that is the
 * whole security model here. Because public_id is derived from `auth.uid()` and
 * is inside the signed payload, there is no argument a caller can supply to
 * target somebody else's avatar.
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
    return NextResponse.json(signAvatarUpload(user.id));
  } catch {
    // Don't echo the thrown message — it names the missing env vars.
    return NextResponse.json(
      { error: "Photo uploads aren't configured." },
      { status: 503 },
    );
  }
}

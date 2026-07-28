import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { buildVCard, vcardFilename } from "@/lib/vcard";
import { fetchPhotoForVCard } from "@/lib/contacts/photo";
import { siteUrl } from "@/lib/site";

/**
 * Serves a connection's contact card.
 *
 * Generated server-side rather than in the browser so the escaping in
 * src/lib/vcard.ts is the single path any .vcf can come from, and so
 * authorization is re-checked at download time rather than trusted from
 * whatever the page was rendered with.
 *
 * §1: this is a LIVE POINTER. The card is built from the profile as it is right
 * now, not from a snapshot taken when the two people connected — so re-saving
 * after someone updates their number gets the new one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
  const { searchParams } = new URL(request.url);

  // `inline` is what turns a DOWNLOAD into the OS contact screen. iOS Safari
  // renders an inline text/vcard as its Add Contact sheet — the same bytes sent
  // as an attachment are just a file in Downloads. Attachment stays the default
  // because on desktop the download IS the right behaviour.
  const inline = searchParams.get("disposition") === "inline";
  // Android can't use the vCard for a prefilled editor (see save-contact.ts), so
  // it needs the same authorised fields as data to build an intent URL from.
  const asJson = searchParams.get("format") === "json";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // An explicit connection check, even though RLS would already withhold the
  // contact details. Without it, a stranger's id yields a card containing just
  // their public name — a valid-looking download that quietly contains nothing,
  // which is worse than a clean 404.
  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .or(`user_a.eq.${profileId},user_b.eq.${profileId}`)
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "Not connected." }, { status: 404 });
  }

  const [{ data: profile }, { data: contact }, { data: fields }] = await Promise.all([
    supabase.from("profiles").select("name, bio, photo_url, deleted_at").eq("id", profileId).single(),
    // Connection-gated by RLS (§4) — returns nothing if the connection isn't active.
    supabase.from("contact_details").select("phone, email").eq("profile_id", profileId).maybeSingle(),
    // is_public filtering is RLS's job here, unlike in connect_via_scan.
    supabase.from("custom_fields").select("label, value").eq("profile_id", profileId).order("sort_order"),
  ]);

  if (!profile) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // §8: a deleted account is still a real connection, but its card would just
  // say "Deleted account" with no details — nothing worth writing to an address
  // book, and actively harmful if it overwrote a good entry (§5.7's one-tap
  // "Update phone contact" is exactly that path).
  if (profile.deleted_at) {
    return NextResponse.json({ error: "This account was deleted." }, { status: 410 });
  }

  // Recorded before the JSON branch returns, so the Android path counts as a
  // handover too (§5.7) — it hands over exactly the same details.
  await supabase
    .from("contact_saves")
    .upsert(
      { owner_id: user.id, subject_id: profileId, saved_at: new Date().toISOString() },
      { onConflict: "owner_id,subject_id" },
    );

  if (asJson) {
    return NextResponse.json(
      {
        name: profile.name,
        phone: contact?.phone ?? null,
        email: contact?.email ?? null,
        bio: profile.bio,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  }

  const vcard = buildVCard({
    name: profile.name,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    bio: profile.bio,
    photoUrl: profile.photo_url,
    // Awaited rather than raced with the response: a card without the photo is
    // a card the user has to redo. fetchPhotoForVCard caps its own time at 3s
    // and returns null rather than throwing, so the worst case is today's
    // behaviour plus a short delay.
    photo: await fetchPhotoForVCard(profile.photo_url),
    customFields: fields ?? [],
    sourceUrl: siteUrl(),
  });

  return new NextResponse(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${vcardFilename(profile.name)}"`,
      // Live pointer: never let a CDN or the browser serve a stale card.
      "Cache-Control": "no-store, private",
    },
  });
}

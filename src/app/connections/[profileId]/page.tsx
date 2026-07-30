import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ScannedProfile } from "@/lib/supabase/database.types";
import { ConnectedProfileCard } from "@/components/connected-profile-card";
import { AutoSaveContact } from "@/components/auto-save-contact";

export const metadata = { title: "Connection · QR Connect" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One connection, with the contact save front and centre (§5.2).
 *
 * This is the SCANNED person's counterpart to /connect/[token]. The scanner
 * lands on that page and gets a profile card and a save button; the scanned
 * person took no action and previously got only a toast or a push that dropped
 * them on a list. Both sides now land on the same shape of page — the
 * notification opens this, and the save fires on arrival where the platform
 * allows it.
 *
 * Deliberately NOT under /connect/: that prefix takes a qr_token and MUTATES
 * state through connect_via_scan. This route takes a profile id and only reads.
 * Same page for the user, very different thing for the server.
 */
export default async function ConnectionPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  if (!UUID.test(profileId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/connections/${profileId}`)}`);

  // The connection is what authorises everything below, so it is checked before
  // anything is read — same order as the vCard endpoint. RLS would withhold the
  // contact details anyway, but a page that renders a stranger's public name
  // back to whoever asks is its own small disclosure.
  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .or(`user_a.eq.${profileId},user_b.eq.${profileId}`)
    .maybeSingle();
  if (!connection) notFound();

  const [{ data: profile }, { data: contact }, { data: fields }] = await Promise.all([
    supabase.from("profiles").select("name, photo_url, bio, deleted_at").eq("id", profileId).maybeSingle(),
    // Both of these are connection-gated by RLS (§4), and custom_fields is
    // is_public-filtered there too — no hand-filtering needed, unlike inside
    // connect_via_scan where DEFINER bypasses the policies.
    supabase.from("contact_details").select("phone, email").eq("profile_id", profileId).maybeSingle(),
    supabase.from("custom_fields").select("label, value").eq("profile_id", profileId).order("sort_order"),
  ]);

  if (!profile) notFound();

  // §8: a deleted account keeps its connection but has no card worth saving, so
  // this degrades to a placeholder rather than auto-opening an empty contact.
  if (profile.deleted_at) {
    return (
      <Shell title="This account was deleted">
        <p className="rounded-brutal border-2 border-ink bg-paper p-3 text-sm font-medium shadow-brutal">
          You&apos;re still connected, but there&apos;s no contact information to
          save any more.
        </p>
      </Shell>
    );
  }

  const scanned: ScannedProfile = {
    id: profileId,
    name: profile.name,
    photo_url: profile.photo_url,
    bio: profile.bio,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    custom_fields: fields ?? [],
  };

  return (
    <Shell title={`You're connected with ${profile.name}`}>
      <div className="mt-4">
        <ConnectedProfileCard profile={scanned} />
      </div>

      <div className="mt-6">
        <AutoSaveContact profileId={profileId} name={profile.name} />
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-2xl leading-tight tracking-tight text-balance">
        {title}
      </h1>
      <div className="mt-4">{children}</div>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/connections"
          className="rounded-brutal border-2 border-ink bg-paper px-3 py-2 text-sm font-bold shadow-brutal-sm nb-press-sm"
        >
          Your connections
        </Link>
        <Link
          href="/scan"
          className="rounded-brutal border-2 border-ink bg-paper px-3 py-2 text-sm font-bold shadow-brutal-sm nb-press-sm"
        >
          Scan another
        </Link>
      </div>
    </main>
  );
}

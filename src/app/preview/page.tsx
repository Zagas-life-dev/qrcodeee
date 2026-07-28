import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ScannedProfile } from "@/lib/supabase/database.types";
import { ConnectedProfileCard } from "@/components/connected-profile-card";

export const metadata = { title: "How others see you · QR Connect" };

/**
 * "What does someone actually get when they scan me?"
 *
 * The product has three visibility tiers and nothing else in the UI makes them
 * legible: name/photo/bio are always public, phone/email unlock only on
 * connection, and custom fields are per-field. Someone editing a profile form
 * has no way to tell which bucket a given field landed in — so this page is
 * where that becomes obvious, before they hand their code to a stranger.
 *
 * The card is the SAME component /connect/[token] renders, assembled into the
 * same ScannedProfile shape connect_via_scan returns. That is deliberate: a
 * preview with its own markup drifts, and a preview that lies is worse than no
 * preview at all.
 */
export default async function PreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/preview");

  const [{ data: profile }, { data: contact }, { data: fields }] = await Promise.all([
    supabase.from("profiles").select("id, name, bio, photo_url").eq("id", user.id).single(),
    supabase.from("contact_details").select("phone, email").eq("profile_id", user.id).maybeSingle(),
    supabase
      .from("custom_fields")
      .select("label, value, is_public")
      .eq("profile_id", user.id)
      .order("sort_order", { ascending: true }),
  ]);

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
        <p className="text-sm opacity-70">We couldn&apos;t load your profile.</p>
      </main>
    );
  }

  const allFields = fields ?? [];
  const publicFields = allFields.filter((f) => f.is_public);
  const privateFields = allFields.filter((f) => !f.is_public);

  // Assembled to mirror connect_via_scan's payload exactly — including that it
  // carries only PUBLIC custom fields, which is the filter that function applies
  // by hand because SECURITY DEFINER means RLS isn't doing it for it.
  const asScanned: ScannedProfile = {
    id: profile.id,
    name: profile.name,
    photo_url: profile.photo_url,
    bio: profile.bio,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    custom_fields: publicFields.map((f) => ({ label: f.label, value: f.value })),
  };

  const gaps = [
    !profile.photo_url && "no photo",
    !profile.bio && "no bio",
    !contact?.phone && "no phone number",
    !contact?.email && "no email address",
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">How others see you</h1>
      <p className="mt-1 text-sm opacity-70">
        This is exactly what someone gets after scanning your code — the same
        screen they see, built from the same data.
      </p>

      <div className="mt-6">
        <ConnectedProfileCard profile={asScanned} />
      </div>

      {gaps.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Your profile has {gaps.join(", ")}.</p>
          <p className="mt-1 text-sm opacity-80">
            Anything you leave out shows as &ldquo;Not provided&rdquo; and
            won&apos;t appear on the contact card they save.
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex rounded-md border border-current/20 px-3 py-1.5 text-sm transition hover:bg-current/5"
          >
            Fill in the gaps
          </Link>
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
          Who can see what
        </h2>

        <dl className="mt-3 space-y-3 text-sm">
          <Tier
            label="Anyone who opens your profile"
            items={["Your name", "Your photo", "Your bio", ...publicFields.map((f) => f.label)]}
          />
          <Tier
            label="Only people you've connected with"
            items={["Your phone number", "Your email address"]}
            note="These stay hidden until someone scans your code. Blocking someone takes them away again."
          />
          <Tier
            label="Nobody but you"
            items={privateFields.map((f) => f.label)}
            empty="You haven't marked any custom fields private."
            note="Private fields never leave your account — not on the profile, not on the saved contact card."
          />
        </dl>
      </section>

      <div className="mt-10 flex flex-wrap gap-2">
        <Link
          href="/profile"
          className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
        >
          Edit profile
        </Link>
        <Link
          href="/qr"
          className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
        >
          Your QR code
        </Link>
      </div>
    </main>
  );
}

function Tier({
  label, items, note, empty,
}: {
  label: string;
  items: string[];
  note?: string;
  empty?: string;
}) {
  return (
    <div className="rounded-lg border border-current/15 p-3">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="mt-1.5">
        {items.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <li
                key={item}
                className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-80"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-50">{empty}</p>
        )}
        {note ? <p className="mt-2 text-xs opacity-60">{note}</p> : null}
      </dd>
    </div>
  );
}

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
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12 sm:px-6">
        <p className="rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-bold shadow-brutal">
          We couldn&apos;t load your profile.
        </p>
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
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl leading-none tracking-tight">
        How others see you
      </h1>
      <p className="mt-3 text-sm font-medium">
        This is exactly what someone gets after scanning your code — the same
        screen they see, built from the same data.
      </p>

      <div className="mt-6">
        <ConnectedProfileCard profile={asScanned} />
      </div>

      {gaps.length > 0 ? (
        <div className="mt-4 rounded-brutal border-2 border-ink bg-lemon p-4 shadow-brutal">
          <p className="font-display text-sm">Your profile has {gaps.join(", ")}.</p>
          <p className="mt-2 text-sm font-medium">
            Anything you leave out shows as &ldquo;Not provided&rdquo; and
            won&apos;t appear on the contact card they save.
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex rounded-brutal border-2 border-ink bg-paper px-3 py-2 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Fill in the gaps
          </Link>
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="font-display text-xl leading-none tracking-tight">
          Who can see what
        </h2>

        {/* Each tier takes its own fill, widest reach to narrowest. The colour
            is reinforcement, never the message: every tier states its audience
            in words, so the three stay distinguishable in greyscale and to a
            screen reader. */}
        <dl className="mt-4 space-y-3 text-sm">
          <Tier
            tone="bg-lime"
            label="Anyone who opens your profile"
            items={["Your name", "Your photo", "Your bio", ...publicFields.map((f) => f.label)]}
          />
          <Tier
            tone="bg-sky"
            label="Only people you've connected with"
            items={["Your phone number", "Your email address"]}
            note="These stay hidden until someone scans your code. Blocking someone takes them away again."
          />
          <Tier
            tone="bg-lilac"
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
          className="rounded-brutal border-2 border-ink bg-lemon px-4 py-2 text-sm font-bold shadow-brutal nb-press"
        >
          Edit profile
        </Link>
        <Link
          href="/qr"
          className="rounded-brutal border-2 border-ink bg-paper px-4 py-2 text-sm font-bold shadow-brutal nb-press"
        >
          Your QR code
        </Link>
      </div>
    </main>
  );
}

function Tier({
  tone, label, items, note, empty,
}: {
  /** The tier's fill, as a Tailwind class — see the note at the call site. */
  tone: string;
  label: string;
  items: string[];
  note?: string;
  empty?: string;
}) {
  return (
    <div className={`rounded-brutal border-2 border-ink p-3 shadow-brutal ${tone}`}>
      <dt className="font-display text-sm">{label}</dt>
      <dd className="mt-2">
        {items.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <li
                key={item}
                className="rounded-full border-2 border-ink bg-paper px-2.5 py-0.5 text-xs font-bold"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs font-medium">{empty}</p>
        )}
        {note ? <p className="mt-2.5 text-xs font-medium">{note}</p> : null}
      </dd>
    </div>
  );
}

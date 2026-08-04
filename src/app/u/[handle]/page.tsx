import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { getSessionUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeHandle, resolveHandle } from "@/lib/handles/resolve";
import { getGatedBlocks, getPublicSite } from "@/lib/site/read";
import { isFreshEncounter } from "@/lib/contacts/encounter";
import { scanExplanation } from "@/lib/contacts/scan-explain";
import { siteUrl } from "@/lib/site";
import type { PublicProfile } from "@/lib/supabase/database.types";
import { AutoSaveContact } from "@/components/auto-save-contact";
import { ConnectionActions } from "@/components/connection-actions";
import { ContactDetails } from "@/components/site/contact-details";
import { SiteRender } from "@/components/site/site-render";
import { SkeletonCard } from "@/components/skeleton";
import { ActionLink, Notice, Page, PageHeader, Section } from "@/components/page";

type Params = {
  params: Promise<{ handle: string }>;
  /**
   * `?e=` explains a scan that didn't connect (see the redemption route). It is
   * display-only and grants nothing — the page renders the same for everyone
   * whatever it says, so a forged one is a sentence someone typed to themselves.
   *
   * `?c=` never reaches here: `src/proxy.ts` rewrites a URL carrying one to the
   * redemption route, which redirects back without it.
   */
  searchParams: Promise<{ e?: string }>;
};

/**
 * The permanent public profile (site-spec S3) — the page a handle points at, and
 * the first route in this product reachable without an account.
 *
 * TWO HALVES, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   VIEWER-INDEPENDENT — `resolveHandle`, which is `use cache`. Name, photo,
 *   bio, identical for every visitor, one database read shared across all of
 *   them.
 *
 *   VIEWER-DEPENDENT — the block check, contact details, custom fields, the call
 *   to action. Read with the cookie-bound client so RLS evaluates against the
 *   actual viewer, and never inside a cached scope. Collapsing the two is the
 *   mistake this file exists to avoid: the first person to miss the cache would
 *   decide what everyone else sees, with their own RLS evaluation baked in.
 *
 * KNOWN CONSEQUENCE — SOFT 404s. `loading.tsx` is this route's Suspense
 * boundary, so the shell flushes with a 200 before `notFound()` runs and a
 * missing handle renders the right page under the wrong status. The same applies
 * to the `moved` redirect, which becomes a client-side navigation rather than a
 * 301.
 *
 * It is not fixable by moving the resolve into the shell — that was tried.
 * `resolveHandle` being cached does make it legal outside a boundary, but
 * `await params` is itself uncached runtime data on a dynamic segment with no
 * `generateStaticParams`, so the route refuses to prerender either way.
 *
 * Harmless today because `generateMetadata` marks every one of these pages
 * `noindex` (S12), so nothing is crawling them. It stops being harmless the
 * moment indexing is switched on, and the fix then is upstream of the render —
 * `proxy.ts` resolving unknown handles to a real 404 before Next is reached.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const handle = normalizeHandle((await params).handle);
  const resolution = await resolveHandle(handle);

  if (resolution.status !== "found") {
    return { title: "Not found · Skan QR", robots: { index: false, follow: false } };
  }

  const { name, bio, photo_url } = resolution.profile;
  const description = bio ?? `${name} on Skan QR. Scan once, swap details.`;

  return {
    title: `${name} · Skan QR`,
    description,
    alternates: { canonical: `${siteUrl()}/u/${handle}` },
    openGraph: {
      type: "profile",
      title: name,
      description,
      url: `${siteUrl()}/u/${handle}`,
      images: photo_url ? [{ url: photo_url }] : undefined,
    },
    twitter: {
      card: photo_url ? "summary_large_image" : "summary",
      title: name,
      description,
      images: photo_url ? [photo_url] : undefined,
    },
    /**
     * S12: no page is indexable yet. The trust bar (photo + at least one
     * connection) is not built, and shipping an indexable public page before it
     * means the first spam sign-ups get indexed under our domain. Flipping this
     * on is a deliberate later step, not something to leave to a default.
     */
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params, searchParams }: Params) {
  const raw = (await params).handle;
  const handle = normalizeHandle(raw);
  const explain = scanExplanation((await searchParams).e);

  // Canonicalise first, so `/u/Ada` and `/u/ada` are not two pages with the same
  // content and the cache has one key per profile rather than one per
  // capitalisation someone happened to type.
  if (handle !== raw) permanentRedirect(`/u/${handle}`);

  const resolution = await resolveHandle(handle);

  if (resolution.status === "not_found") notFound();

  // A parked handle redirects rather than continuing to serve the profile: an
  // old address that still works never falls out of circulation.
  if (resolution.status === "moved") permanentRedirect(`/u/${resolution.handle}`);

  if (resolution.status === "deleted") {
    return (
      <Page width="md">
        <PageHeader title="This account was deleted" size="sm" />
        <Notice className="mt-6">
          There&apos;s nothing here any more. If you have this person&apos;s
          details saved, they won&apos;t be updated again.
        </Notice>
      </Page>
    );
  }

  return (
    // `lg` rather than `md`, and the reason is the SECTIONS rather than the
    // card. A bento's row splits collapse to a column below 21rem per pane
    // (globals.css), so a 28rem page meant a two-pane band was stacked on every
    // device including a desktop — the owner arranged a layout that nobody could
    // ever see. The contact card is capped separately below so it doesn't
    // stretch into a letterbox to pay for it.
    <Page width="lg">
      {/* Outside the boundary: it explains a scan that has already failed, and
          holding it behind the viewer-scoped read would show it after the page
          it is apologising for. App-styled, like every other affordance in the
          unthemed half — this is us talking, not the page's owner. */}
      {explain ? (
        <Notice tone="warn" role="status" className="mb-6 max-w-md">
          {explain}
        </Notice>
      ) : null}

      <Suspense fallback={<ProfileSkeleton />}>
        <ViewerScopedProfile handle={handle} profile={resolution.profile} />
      </Suspense>
    </Page>
  );
}

/**
 * Everything that depends on who is asking — which is everything about the
 * person, because the block check has to be able to withhold all of it.
 *
 * `profile` is passed in rather than re-resolved: it came from the cached read
 * in the shell, and fetching it again here would double the round trips to
 * produce the identical bytes.
 */
async function ViewerScopedProfile({
  handle,
  profile,
}: {
  handle: string;
  profile: PublicProfile;
}) {
  const user = await getSessionUser();

  /**
   * The block check (S9.3), and it costs no extra query because RLS already
   * does it: the "profiles are publicly readable" policy carries
   * `not private.is_blocked(auth.uid(), id)`, so a signed-in viewer on either
   * side of a block cannot read the row at all. If they can't, they get the
   * blocked state instead of the profile.
   *
   * Only runs when there IS a session. An anonymous visitor has no identity to
   * check against — the documented ceiling of a public URL, not a gap to close
   * here.
   */
  const supabase = await createClient();

  if (user) {
    const { data: visible } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", profile.id)
      .maybeSingle();

    if (!visible) {
      return (
        <>
          <PageHeader title="This page isn't available to you" size="sm" />
          <Notice className="mt-6">
            You and this person have blocked each other, or one of you has.
          </Notice>
          <div className="mt-8">
            <ActionLink href="/connections">Your connections</ActionLink>
          </div>
        </>
      );
    }
  }

  const isOwner = user?.id === profile.id;

  // The site's two halves (S8). `getPublicSite` is the cached, viewer-
  // independent read; `getGatedBlocks` is per-viewer and returns [] for anyone
  // RLS says isn't connected. They are merged in the renderer, so nothing
  // downstream branches on which is which. Skipped entirely for a signed-out
  // visitor, who can never be a connection.
  //
  // An UNPUBLISHED site is no longer null here — it comes back holding just its
  // pinned identity section, which is what keeps this page identifiable before
  // anyone has built anything on it.
  const [site, gatedBlocks] = await Promise.all([
    getPublicSite(profile.id),
    user ? getGatedBlocks(profile.id) : Promise.resolve([]),
  ]);

  // Both of these are RLS-gated and neither needs hand-filtering: contact_details
  // is connection-only, custom_fields is is_public-filtered for everyone but the
  // owner. An anonymous visitor gets no contact row and the public fields, which
  // is exactly the public tier — no branching required to produce it.
  const [{ data: contact }, { data: fields }, { data: connection }] = await Promise.all([
    supabase
      .from("contact_details")
      .select("phone, email")
      .eq("profile_id", profile.id)
      .maybeSingle(),
    supabase
      .from("custom_fields")
      .select("label, value")
      .eq("profile_id", profile.id)
      .order("sort_order"),
    /**
     * The connection is the authorisation AND the encounter clock.
     *
     * `connected_at` is what decides whether the contact sheet may open by
     * itself — see lib/contacts/encounter.ts. It is read here, from a row RLS
     * scopes to the two parties, precisely so that nothing in the URL has to
     * carry that decision. `connection_epoch` distinguishes a genuine
     * reconnection from the same one.
     */
    user && !isOwner
      ? supabase
          .from("connections")
          .select("id, connected_at, connection_epoch")
          .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      {/* The visible name is the identity block's, inside the themed page. This
          is here so the document still has exactly one h1 and a screen reader
          still gets the page's name before its contents — a block's heading is
          an h2, and promoting it would mean the same component emitting a
          different level in the editor than on the page. */}
      <h1 className="sr-only">{profile.name}</h1>

      {/* THE PAGE ITSELF, INCLUDING WHO IT BELONGS TO. There is no app-drawn
          contact card in front of this any more: the identity is the permanent
          first section of the owner's own site, and the details panel is slotted
          in behind it. An unpublished site still renders — its pinned section is
          exempt from the publication check in RLS — so a handle is useful from
          the moment it exists, which is the guarantee the old hardcoded card was
          carrying. */}
      {site ? (
        <SiteRender
          site={site}
          gatedBlocks={gatedBlocks}
          owner={{
            id: profile.id,
            name: profile.name,
            photoUrl: profile.photo_url,
            bio: profile.bio,
            handle,
          }}
          contact={
            <>
              <ContactDetails
                phone={contact?.phone ?? null}
                email={contact?.email ?? null}
                fields={fields ?? []}
                // Only the owner is shown the gaps in their own profile. A
                // visitor gets what exists; a stranger's RLS-emptied read
                // therefore renders nothing at all rather than a list of
                // "Not provided", which advertised how much was being withheld.
                showGaps={isOwner}
              />

              {/* THE SAVE SITS WITH THE DETAILS, not at the foot of the page.
                  It is the action on the thing directly above it, and the
                  person reading this scanned a code ten seconds ago — putting
                  it below five sections of someone's page puts the whole
                  product behind a scroll.

                  App-styled inside a themed page, deliberately: this is the one
                  surface that says "this is Skan QR and this is what tapping
                  does", and it is not customer-configurable. See the boundary
                  note in globals.css. */}
              {connection ? (
                // `text-ink` because this block sits INSIDE the themed page and
                // would otherwise inherit `--sk-ink` — which on the glass skin
                // is near-white, i.e. white text on a lime button. The whole
                // point of this surface is that it looks like ours under every
                // skin, so it cannot inherit the skin's foreground.
                <div className="max-w-md text-ink">
                  <AutoSaveContact
                    profileId={profile.id}
                    name={profile.name}
                    epoch={connection.connection_epoch}
                    // Server-side, from a row only these two can read. Nothing
                    // in the URL can make this true.
                    fresh={isFreshEncounter(connection.connected_at)}
                  />
                </div>
              ) : null}
            </>
          }
        />
      ) : (
        /* No site row to render — the profile exists but its site is
           unreachable. Rare (a failed signup trigger), and the name is the one
           thing worth showing rather than a blank page. */
        <PageHeader title={profile.name} size="sm" />
      )}

      {/* Capped at reading width while the sections above run full: this is one
          panel of copy and a button, not a band across the page.

          IT IS ALSO THE UNTHEMED HALF. Everything above takes the owner's skin;
          the save/connect affordances keep app styling under every one of them,
          because that is the surface saying "this is Skan QR and this is what
          tapping does" — see the boundary note in globals.css. */}
      <div className="mt-8 max-w-md">
        {isOwner ? (
          <OwnerActions handle={handle} />
        ) : connection ? (
          /* Disconnect, block and report. They lived on a per-connection detail
             page, which is gone: this page is the one page a person has in this
             product, so managing your connection to someone belongs on it. Last
             on the page and behind a menu — these are the things you reach for
             rarely and never by accident. */
          <Section title="Manage">
            <ConnectionActions
              connectionId={connection.id}
              profileId={profile.id}
              name={profile.name}
              layout="inline"
            />
          </Section>
        ) : user ? (
          <StrangerActions name={profile.name} />
        ) : (
          <VisitorActions name={profile.name} handle={handle} />
        )}
      </div>
    </>
  );
}

/**
 * Mirrors the resolved layout's geometry so nothing jumps when it swaps in:
 * identity, details, then the actions. No title bar — the page's h1 is
 * `sr-only` now that the identity block carries the visible name.
 */
function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <SkeletonCard className="h-64" />
      <div className="mt-6">
        <SkeletonCard className="h-40" />
      </div>
      <div className="mt-8 max-w-md">
        <SkeletonCard className="h-32" />
      </div>
    </div>
  );
}

function OwnerActions({ handle }: { handle: string }) {
  return (
    <div className="rounded-brutal border-2 border-ink bg-lime p-4 shadow-brutal">
      <p className="font-display text-sm">This is your public page.</p>
      <p className="mt-2 text-sm font-medium">
        Anyone with the link sees your name, photo and bio. Your phone and email
        stay hidden until someone connects with you.
      </p>
      <p className="mt-2 font-mono text-xs break-all">{`${siteUrl()}/u/${handle}`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionLink href="/profile">Edit profile</ActionLink>
        <ActionLink href="/qr">Your QR code</ActionLink>
      </div>
    </div>
  );
}

function StrangerActions({ name }: { name: string }) {
  return (
    <div className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
      <p className="font-display text-sm">You&apos;re not connected yet.</p>
      <p className="mt-2 text-sm font-medium">
        Scan {name}&apos;s QR code to swap details. Connecting is what unlocks
        their phone number and email — a link alone never does.
      </p>
      <div className="mt-3">
        <ActionLink href="/scan" tone="primary">
          Scan a code
        </ActionLink>
      </div>
    </div>
  );
}

/**
 * The growth loop, and the reason this page is public at all: every profile is
 * a landing page. Deliberately does not overstate what signing up does — it does
 * not connect you to this person, only scanning does.
 */
function VisitorActions({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="rounded-brutal border-2 border-ink bg-lilac p-4 shadow-brutal">
      <p className="font-display text-sm">Get a page like this one.</p>
      <p className="mt-2 text-sm font-medium">
        Skan QR gives you a code people scan once to swap contact details — no
        typing, no &ldquo;add me back&rdquo;. To connect with {name}, you&apos;ll
        need to scan their code in person.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionLink
          href={`/login?next=${encodeURIComponent(`/u/${handle}`)}`}
          tone="primary"
          size="lg"
        >
          Get started
        </ActionLink>
        <Link
          href="/login"
          className="inline-flex min-h-9 items-center text-sm font-semibold underline"
        >
          I already have an account
        </Link>
      </div>
    </div>
  );
}

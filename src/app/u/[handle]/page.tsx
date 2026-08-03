import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { getSessionUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeHandle, resolveHandle } from "@/lib/handles/resolve";
import { getGatedBlocks, getPublicSite } from "@/lib/site/read";
import { siteUrl } from "@/lib/site";
import type { PublicProfile, ScannedProfile } from "@/lib/supabase/database.types";
import { ConnectedProfileCard } from "@/components/connected-profile-card";
import { SiteRender } from "@/components/site/site-render";
import { SkeletonCard } from "@/components/skeleton";
import { ActionLink, Notice, Page, PageHeader } from "@/components/page";

type Params = { params: Promise<{ handle: string }> };

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

export default async function PublicProfilePage({ params }: Params) {
  const raw = (await params).handle;
  const handle = normalizeHandle(raw);

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
  // independent read and returns null for an unpublished site; `getGatedBlocks`
  // is per-viewer and returns [] for anyone RLS says isn't connected. They are
  // merged in the renderer, so nothing downstream branches on which is which.
  // Skipped entirely for a signed-out visitor, who can never be a connection.
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
    user && !isOwner
      ? supabase
          .from("connections")
          .select("id")
          .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const scanned: ScannedProfile = {
    id: profile.id,
    name: profile.name,
    photo_url: profile.photo_url,
    bio: profile.bio,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    custom_fields: fields ?? [],
  };

  return (
    <>
      <PageHeader title={profile.name} size="sm" />

      {/* The card keeps its own reading width whatever the page does — it is a
          business card, and a business card 42rem wide is a banner. */}
      <div className="mt-6 max-w-md">
        <ConnectedProfileCard profile={scanned} hero />
      </div>

      {/* The custom page, below the contact card. Renders nothing at all when
          the site is unpublished or empty, which is why the handle page is
          useful from the moment it exists — blocks are additive to a page that
          already works, never a precondition for it. */}
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
        />
      ) : null}

      {/* Capped with the card, for the same reason: these are one panel of
          copy and a button, not a band across the page. */}
      <div className="mt-8 max-w-md">
        {isOwner ? (
          <OwnerActions handle={handle} />
        ) : connection ? (
          <ActionLink href={`/connections/${profile.id}`} tone="primary" size="lg">
            Open in your connections
          </ActionLink>
        ) : user ? (
          <StrangerActions name={profile.name} />
        ) : (
          <VisitorActions name={profile.name} handle={handle} />
        )}
      </div>
    </>
  );
}

/** Mirrors the resolved layout's geometry so nothing jumps when it swaps in. */
function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="max-w-md">
      <div className="h-8 w-44 animate-pulse rounded-brutal border-2 border-ink bg-paper" />
      <div className="mt-6">
        <SkeletonCard className="h-72" />
      </div>
      <div className="mt-8">
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

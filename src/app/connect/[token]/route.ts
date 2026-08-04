import { NextResponse, after, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { sendPushToProfile } from "@/lib/push/send";
import { siteUrl } from "@/lib/site";
import type { ScanResult } from "@/lib/supabase/database.types";

/**
 * Redeeming a scanned code (§6). Everything the product does happens here, and
 * none of it is visible: this route connects the two people and sends the
 * scanner to the page they actually wanted, which is the person's own.
 *
 * IT WAS A PAGE AND IS NOW A REDIRECT. The page rendered a result screen — a
 * hero contact card, a save button, some copy — which is a second, worse copy of
 * `/u/{handle}` now that the public page carries the identity block and the
 * contact details. There is nothing left for it to render, so it renders
 * nothing.
 *
 * HOW A SCANNER GETS HERE. QR codes encode `/u/{handle}?c={token}`;
 * `src/proxy.ts` rewrites that to this route. Codes minted before that change
 * encode this path directly and still work — the token, not the URL shape, is
 * what resolves.
 *
 * THE HANDLE IN THE SCANNED URL IS NEVER TRUSTED. `connect_via_scan` resolves
 * the token to a profile and this redirects to THAT profile's handle, so a
 * hand-crafted `/u/alice?c={bobs-token}` connects you to Bob and lands you on
 * Bob's page. The handle exists in the payload so a plain camera app shows a URL
 * a person can recognise; it decides nothing.
 *
 * WHAT MAKES THE LANDING SAFE. Nothing is appended to say "a connection just
 * happened" — the page works that out from `connections.connected_at`, which
 * only the two parties can read. There is no marker to share, forge, or re-fire
 * by refreshing. See the freshness rule in components/auto-save-contact.tsx.
 *
 * NO `export const dynamic` — Cache Components (next.config.ts) rejects the
 * segment config outright, and it would be redundant anyway: this route reads
 * cookies and the request URL, so it can never be prerendered. What actually
 * matters is the `no-store` on the response, and that is set by hand below.
 */

/** `?e=` on the landing page: display-only, grants nothing, explains a failure. */
type Explain = "expired" | "slow";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  /**
   * The URL the browser is actually on.
   *
   * After the proxy's rewrite this is still the scanned `/u/{handle}?c={token}`:
   * Next routes on the rewritten path but hands the handler the ORIGINAL
   * request. That is what makes the two values below readable without anything
   * being smuggled through the query string.
   *
   * `scannedHandle` is a FALLBACK DESTINATION and nothing else. An expired token
   * resolves to nobody, and bouncing someone to a generic error screen is worse
   * than showing them the page they were plainly trying to reach with a line
   * explaining what happened. It never decides who you connect to.
   */
  const scannedPath = request.nextUrl.pathname;
  const arrivedOnPublicPage = scannedPath.startsWith("/u/");
  const scannedHandle = arrivedOnPublicPage
    ? safeHandle(scannedPath.slice("/u/".length))
    : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // §5.1: an unauthenticated scanner must never be asked to scan again. The
  // whole scanned URL rides through login as `next`, so the proxy rewrites it
  // again on return and the connection completes without a second scan.
  if (!user) {
    // The whole scanned URL, verbatim, so the proxy rewrites it again on return
    // and the connection completes without a second scan.
    const back = arrivedOnPublicPage
      ? `${scannedPath}${request.nextUrl.search}`
      : `/connect/${encodeURIComponent(token)}`;
    return go(request, `/login?next=${encodeURIComponent(back)}`);
  }

  const { data, error } = await supabase.rpc("connect_via_scan", {
    scanned_token: token,
  });

  if (error) return go(request, landing(scannedHandle, "expired"));

  const result = data as ScanResult;

  switch (result.status) {
    // Deliberately indistinguishable from each other at the RPC, and they stay
    // that way here: naming a block would disclose it to the person it was
    // placed against. Both land on the page with the same explanation, and a
    // blocked viewer's page renders its own "not available to you" state
    // because `is_blocked` is in the RLS policy.
    case "invalid_token":
    case "blocked":
      return go(request, landing(scannedHandle, "expired"));

    case "rate_limited":
      return go(request, landing(scannedHandle, "slow"));

    // No error state worth building: you scanned your own code, so you get your
    // own page, where `OwnerActions` already says as much.
    case "self_scan":
      return go(request, landing(result.profile?.handle ?? scannedHandle));

    case "unauthenticated":
      return go(
        request,
        `/login?next=${encodeURIComponent(`/connect/${encodeURIComponent(token)}`)}`,
      );

    case "new_connection":
    case "already_connected": {
      if (result.status === "new_connection") {
        await notifyScanned(supabase, user.id, result);
      }
      return go(request, landing(result.profile.handle ?? scannedHandle));
    }
  }
}

/**
 * §5.2 step 3: the scanned person took no action and may not have the app open,
 * so Web Push is the only way to reach them. `connect_via_scan` already wrote
 * the notification row (§5.1); this is the delivery.
 *
 * The scanner's own name and handle are read HERE rather than inside `after()`,
 * because after() runs once the response is done and request-scoped cookie
 * access is no longer guaranteed. The push itself goes in after() so the
 * scanner's redirect never waits on a round trip to a push service.
 */
async function notifyScanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scannerId: string,
  result: Extract<ScanResult, { status: "new_connection" }>,
) {
  const scannedId = result.profile.id;
  const epoch = result.connection_epoch;

  const { data: me } = await supabase
    .from("profiles")
    .select("name, handle")
    .eq("id", scannerId)
    .maybeSingle();

  after(async () => {
    // sendPushToProfile never throws, but the surrounding catch makes it
    // explicit that a delivery failure must not affect a connection that is
    // already committed — §5.2 step 4's reconcile-on-open covers the miss.
    try {
      await sendPushToProfile(scannedId, {
        title: "New connection",
        body: `${me?.name ?? "Someone"} connected with you. Save their contact so you don't lose it.`,
        // The scanned person's counterpart to the page the scanner is looking
        // at right now — the scanner's own public page, with the same save on
        // it. No marker on the URL: if they tap within the freshness window the
        // sheet opens by itself, and if they tap an hour later they get the
        // page with Save as the focused action. A push that is hours old is not
        // a live encounter and should not behave like one.
        url: me?.handle ? `${siteUrl()}/u/${encodeURIComponent(me.handle)}` : siteUrl(),
        // Per connection AND epoch: duplicates collapse, but a genuine
        // reconnect (§5.1) still surfaces as a new notification.
        tag: `connection:${scannedId}:${epoch}`,
      });
    } catch {
      // swallowed deliberately
    }
  });
}

/**
 * A path segment reduced to something that can only be a handle.
 *
 * This value comes off the URL a stranger scanned, so it is attacker-supplied,
 * and it is about to be interpolated into a redirect. Handles are validated on
 * the way in (lib/handles/format.ts) to exactly this alphabet, so anything else
 * cannot name a real page and is dropped rather than escaped — a redirect built
 * from a rejected value is a redirect nobody asked for.
 */
function safeHandle(segment: string): string | null {
  const value = segment.toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,38}$/.test(value) ? value : null;
}

/** Where a scan ends up. `/scan` only when there is no handle to go to at all. */
function landing(handle: string | null | undefined, explain?: Explain): string {
  if (!handle) return explain ? `/scan?e=${explain}` : "/scan";
  const path = `/u/${encodeURIComponent(handle)}`;
  return explain ? `${path}?e=${explain}` : path;
}

/**
 * 303, not 307.
 *
 * A 307 preserves the method, and this route is reached by a rewrite of a URL
 * the browser may re-issue. 303 says plainly "the answer is over there, go and
 * GET it" — which is what a redemption that has already happened wants. The
 * no-store header keeps a CDN from caching the redirect and quietly preventing
 * a second scanner from ever redeeming the same still-live token.
 */
function go(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

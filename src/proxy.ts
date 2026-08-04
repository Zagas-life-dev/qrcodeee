import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { checkEdgeLimit, clientIp } from "@/lib/rate-limit-edge";
import { parseConnectToken } from "@/lib/qr/connect-url";

/**
 * Refreshes the Supabase auth session on every request and forwards the rotated
 * cookies to both the incoming request (so Server Components in this same render
 * see the fresh session) and the outgoing response (so the browser stores it).
 *
 * This is token refresh, NOT authorization. Next's own guidance is that Proxy
 * should not be a session-management or authorization solution — and it isn't
 * one here: every access decision in this product is made by RLS at the database
 * (§4), so a request that slips past this file still can't read anything the
 * policies don't allow.
 *
 * Do not add logic between `createServerClient` and `getUser()` — the token
 * refresh has to be the first thing that happens or a Server Component can
 * render against an expired session.
 *
 * (Renamed from `middleware.ts`: the middleware file convention is deprecated in
 * Next 16.2 in favour of `proxy`.)
 */
/**
 * Paths worth an IP-level speed bump (§7: "watch for rapid automated scanning
 * patterns"). Scoped narrowly on purpose — a limit on ordinary page loads would
 * catch a shared office NAT long before it caught anything abusive.
 */
const IP_LIMITED = [
  { prefix: "/connect/", limit: 40, windowMs: 60_000 },
  { prefix: "/api/avatar/sign", limit: 20, windowMs: 60_000 },
  { prefix: "/api/contacts/", limit: 60, windowMs: 60_000 },
];

/**
 * A scanned code, on its way in.
 *
 * QR codes encode `/u/{handle}?c={token}` — the page the scanner ends up on,
 * with the token riding along (see connectUrl in lib/site.ts). This spots that
 * shape so the request can be rewritten to the redemption route.
 *
 * A REWRITE AND NOT A REDIRECT, which is the difference between one entry in the
 * browser's history and two. The address bar keeps the scanned URL while
 * /connect runs; that route's own redirect then replaces it with the clean
 * `/u/{handle}`, so the token never becomes a history entry someone can go
 * "back" to and redeem again.
 *
 * `parseConnectToken` is reused rather than re-implemented: it is the one place
 * that decides what a valid scanned payload looks like, and a second opinion
 * here is a second thing to keep in step. Anything it rejects — a missing code,
 * a non-uuid, a bare `/u/{handle}` with no code at all — falls through to the
 * ordinary page render, which is exactly right. Opening someone's link is not
 * scanning their code.
 */
function scannedToken(url: URL): string | null {
  if (!url.pathname.startsWith("/u/")) return null;
  if (!url.searchParams.has("c")) return null;
  return parseConnectToken(url.toString());
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const redeem = scannedToken(request.nextUrl);

  // §7's speed bump follows the scan rather than the path it used to arrive on:
  // scanners now hit `/u/...?c=` and would otherwise miss the rule entirely.
  const limited = redeem ? "/connect/" : path;
  const rule = IP_LIMITED.find((r) => limited.startsWith(r.prefix));
  if (rule) {
    const key = `${rule.prefix}:${clientIp(request.headers)}`;
    if (!checkEdgeLimit(key, { limit: rule.limit, windowMs: rule.windowMs })) {
      return new NextResponse("Too many requests. Please slow down.", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rule.windowMs / 1000)),
          "Cache-Control": "no-store",
        },
      });
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): getSession() trusts the cookie's contents
  // without revalidating the token against the auth server.
  await supabase.auth.getUser();

  if (redeem) {
    const target = request.nextUrl.clone();
    target.pathname = `/connect/${redeem}`;
    // Only the path is rewritten. Nothing needs to be handed along in the
    // query: Next routes on the rewritten path but gives the handler the
    // ORIGINAL request URL, so the route can read the scanned `/u/{handle}`
    // straight off `request.nextUrl` — which is also the URL it needs to send
    // an unauthenticated scanner back to after login.
    target.searchParams.delete("c");

    const rewritten = NextResponse.rewrite(target, { request });
    // The session refresh above may have rotated the auth cookies onto
    // `response`, which this replaces. Losing them means a scanner whose token
    // was mid-refresh arrives at /connect signed out and is bounced to login.
    for (const cookie of response.cookies.getAll()) rewritten.cookies.set(cookie);
    return rewritten;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Note `/connect/:token`
     * and `/u/:handle` ARE matched on purpose — an unauthenticated scan needs a
     * live session check so it can preserve the token through login (§5.1), and
     * `/u/:handle?c=` is where a scan now arrives before being rewritten.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};

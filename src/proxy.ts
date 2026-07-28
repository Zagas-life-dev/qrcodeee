import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { checkEdgeLimit, clientIp } from "@/lib/rate-limit-edge";

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

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const rule = IP_LIMITED.find((r) => path.startsWith(r.prefix));
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

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Note `/connect/:token` IS
     * matched on purpose — an unauthenticated scan needs a live session check so
     * it can preserve the token through login (§5.1).
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};

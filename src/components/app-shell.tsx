import { Suspense, ViewTransition } from "react";

import { getSessionUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";

import { SideNav } from "./side-nav";
import { SiteHeader } from "./site-header";
import { TabBar } from "./tab-bar";

/**
 * The signed-in chrome, and the reason pages no longer each own their own
 * spacing against it.
 *
 * THREE NAVIGATIONS, ONE PER SIZE, and each is the right shape for its input:
 * a floating thumb dock below `sm`, the header's inline row from `sm` to `lg`,
 * and a persistent rail from `lg` up. The rail is what turns this from a phone
 * app centred on a desktop into something that uses the display — see
 * side-nav.tsx.
 *
 * Renders nothing but its children when signed out, so /login, /u/{handle} and a
 * scanned /connect that lands on a stranger keep a clean full-bleed shell.
 *
 * THE SUSPENSE BOUNDARIES ARE NOT DECORATION. Under Cache Components
 * (next.config.ts) every route is dynamic by default and runtime data read
 * OUTSIDE a boundary blocks the whole route from prerendering — and this
 * component sits in the root layout, so its `auth.getUser()` was blocking every
 * page in the app, not just its own chrome. Wrapping the auth-dependent bars
 * lets each page's static shell prerender and the chrome stream in behind it.
 *
 * THREE boundaries rather than one, because the bars cannot share a component:
 * the header is `sticky` so it has to precede the content in DOM order, the rail
 * is a flex sibling of it, and the dock is `fixed` and follows. `getSessionUser`
 * is request-cached, so the split costs one auth round trip, not three.
 *
 * KNOWN TRADE: with `fallback={null}` the header arrives after first paint on a
 * cold load and pushes the content down by its own height. The alternative —
 * rendering the header frame statically and streaming only its auth-dependent
 * contents — removes the shift but puts branded chrome on signed-out pages,
 * which is a design decision rather than a migration one. Left as-is
 * deliberately; navigations within the installed app keep the layout mounted, so
 * this is a first-load-only cost.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <ShellHeader />
      </Suspense>

      {/* `shell-content` reserves the dock's strip. The reservation is CSS
          rather than a conditional class here, because whether the dock exists
          is exactly the fact this component no longer knows synchronously —
          see globals.css. */}
      <div className="shell-content flex flex-1 flex-col lg:flex-row">
        <Suspense fallback={null}>
          <ShellSideNav />
        </Suspense>

        {/* `min-w-0` or a wide table/carousel inside a page stretches this flex
            child past the viewport and takes the rail with it. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Only the page content is inside the transition; the bars are pinned
              by name in globals.css so they hold still while it swaps. */}
          <ViewTransition>{children}</ViewTransition>
        </div>
      </div>

      <Suspense fallback={null}>
        <ShellTabs />
      </Suspense>
    </>
  );
}

async function ShellHeader() {
  const user = await getSessionUser();
  if (!user) return null;

  // Server-rendered starting count so the badge is correct on first paint
  // instead of flashing in after the client subscribes.
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return <SiteHeader userId={user.id} initialUnread={count ?? 0} />;
}

async function ShellSideNav() {
  const user = await getSessionUser();
  if (!user) return null;

  // The rail's footer links to the public page, so it needs the handle. One
  // indexed lookup on the primary key, and only on `lg` viewports does anything
  // render from it — but it is fetched regardless, because the alternative is a
  // client-side media query deciding whether to fetch, which is a round trip
  // that starts after hydration.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", user.id)
    .maybeSingle();

  return <SideNav handle={profile?.handle ?? null} />;
}

async function ShellTabs() {
  const user = await getSessionUser();
  if (!user) return null;
  return <TabBar />;
}

import { ViewTransition } from "react";

import { createClient } from "@/lib/supabase/server";

import { SiteHeader } from "./site-header";
import { TabBar } from "./tab-bar";

/**
 * The signed-in chrome, and the reason pages no longer each own their own
 * spacing against it.
 *
 * Renders nothing but its children when signed out, so /login and a scanned
 * /connect that lands on a stranger keep a clean full-bleed shell — same rule
 * the old Nav applied, moved up a level now that there are two bars to suppress
 * rather than one.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  // Server-rendered starting count so the badge is correct on first paint
  // instead of flashing in after the client subscribes.
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <>
      <SiteHeader userId={user.id} initialUnread={count ?? 0} />

      {/* The bottom padding clears the fixed tab bar AND the home-indicator
          strip below it. Without it the last row of any list — which on the
          connections page is a card with two controls in it — sits permanently
          under the bar and can't be tapped. */}
      <div className="flex flex-1 flex-col pb-[calc(var(--tab-bar-h)+env(safe-area-inset-bottom))] sm:pb-0">
        {/* Only the page content is inside the transition; the two bars are
            pinned by name in globals.css so they hold still while it swaps. */}
        <ViewTransition>{children}</ViewTransition>
      </div>

      <TabBar />
    </>
  );
}

import { redirect } from "next/navigation";

import { getOwnSite } from "@/lib/site/owner";
import { SiteStoreProvider } from "@/lib/site/store";
import { getSessionUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import { Notice, Page } from "@/components/page";

import { SiteEditor } from "./site-editor";

export const metadata = { title: "Your page · Skan QR" };

/**
 * The editor for /u/{handle} (site-spec S4).
 *
 * Reads through `getOwnSite`, which is uncached and cookie-bound — an editor
 * showing a cached snapshot would tell someone their last save didn't happen.
 * The public page's cached read is a different function for that reason.
 *
 * What this reads is the SNAPSHOT, not what gets rendered. `SiteStoreProvider`
 * folds any unsent edits over the top of it — see store.tsx — so a reload while
 * offline comes back showing work this query knows nothing about.
 */
export default async function SiteEditorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/site");

  const supabase = await createClient();
  const [{ data: profile }, site] = await Promise.all([
    supabase
      .from("profiles")
      .select("handle, name, photo_url, bio")
      .eq("id", user.id)
      .maybeSingle(),
    getOwnSite(),
  ]);

  if (!site || !profile) {
    return (
      <Page>
        <Notice tone="error">
          We couldn&apos;t load your page. If this is a fresh environment, check
          that the migrations in{" "}
          <code className="font-mono">supabase/migrations</code> have been
          applied.
        </Notice>
      </Page>
    );
  }

  return (
    // `full`, because this page is not a column of content — it is a canvas and
    // an inspector, and it manages its own widths (site-editor.tsx). The top
    // padding goes for the same reason: the toolbar is the first thing in it and
    // has to sit directly under the app header to stick to it.
    <Page width="full" className="pt-0!">
      <SiteStoreProvider serverSite={site} profileId={user.id}>
        <SiteEditor
          handle={profile.handle}
          owner={{
            id: user.id,
            name: profile.name,
            photoUrl: profile.photo_url,
            bio: profile.bio,
            handle: profile.handle,
          }}
          publicUrl={`${siteUrl()}/u/${profile.handle}`}
        />
      </SiteStoreProvider>
    </Page>
  );
}

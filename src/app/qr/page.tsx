import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { connectUrl } from "@/lib/site";
import { normalizeQrStyle } from "@/lib/qr/style";
import { mintQrToken } from "@/lib/qr/actions";
import { EnableNotifications } from "@/components/enable-notifications";
import { ActionLink, Columns, Notice, Page, PageHeader } from "@/components/page";

import { QrEditor } from "./qr-editor";

export const metadata = { title: "Your QR code · Skan QR" };

export default async function QrPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/qr");

  const { data: profile } = await supabase
    .from("profiles")
    .select("qr_style")
    .eq("id", user.id)
    .single();

  // §6: minted here rather than read off the profile — there is no permanent
  // token any more. Returns the live one if there is one, so opening this page
  // twice in a minute shows the same code rather than changing it underneath
  // someone who is mid-scan.
  const minted = await mintQrToken();

  if (!profile || !minted.ok) {
    return (
      <Page>
        <Notice tone="error">We couldn&apos;t load your QR code.</Notice>
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Your QR code"
        description="Show this to someone and have them scan it. You'll both be connected straight away — there's nothing to accept."
        actions={
          <ActionLink href="/preview" tone="info">
            How others see you
          </ActionLink>
        }
      />

      {/* The code and its styling controls are the work; the push prompt is
          reference material that used to sit a full screen below them on a
          display with room for both side by side. */}
      <Columns
        aside={
          /* §5.2 step 3: Web Push is the ONLY way to reach the scanned person
             while their app is closed — and the scanned person, by definition,
             is on this page rather than the connect page. Asking only after a
             connection (the connect page) reaches the scanner and no one else,
             which leaves the person whose code gets scanned permanently
             unsubscribed and silent. */
          <EnableNotifications
            title="Get notified the moment someone scans your code"
            body="You won't be looking at your phone when it happens — they scan, and you find out straight away with a one-tap prompt to save their contact."
          />
        }
      >
        {/* Normalised on the way out as well as on the way in: qr_style is jsonb
            with only a size cap, so a row written before a validation change (or
            by anything other than this app) must still render something
            scannable rather than a broken code (§6). */}
        <QrEditor
          initialStyle={normalizeQrStyle(profile.qr_style)}
          connectUrl={connectUrl(minted.token)}
          expiresAt={minted.expiresAt}
        />
      </Columns>
    </Page>
  );
}

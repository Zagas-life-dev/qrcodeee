import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { connectUrl } from "@/lib/site";
import { normalizeQrStyle } from "@/lib/qr/style";
import { mintQrToken } from "@/lib/qr/actions";
import { EnableNotifications } from "@/components/enable-notifications";

import { QrEditor } from "./qr-editor";

export const metadata = { title: "Your QR code · QR Connect" };

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
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12 sm:px-6">
        <p className="rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-bold shadow-brutal">
          We couldn&apos;t load your QR code.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none tracking-tight">
            Your QR code
          </h1>
          <p className="mt-3 text-sm font-medium">
            Show this to someone and have them scan it. You&apos;ll both be
            connected straight away — there&apos;s nothing to accept.
          </p>
          <p className="mt-1 text-sm font-medium">
            This code expires every 15 minutes and refreshes itself, so a
            screenshot of it can&apos;t be used later.
          </p>
        </div>
        <Link
          href="/preview"
          className="flex min-h-11 shrink-0 items-center rounded-brutal border-2 border-ink bg-sky px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
        >
          How others see you
        </Link>
      </div>

      {/* Normalised on the way out as well as on the way in: qr_style is jsonb
          with only a size cap, so a row written before a validation change (or
          by anything other than this app) must still render something scannable
          rather than a broken code (§6). */}
      <QrEditor
        initialStyle={normalizeQrStyle(profile.qr_style)}
        connectUrl={connectUrl(minted.token)}
        expiresAt={minted.expiresAt}
      />

      {/* §5.2 step 3: Web Push is the ONLY way to reach the scanned person while
          their app is closed — and the scanned person, by definition, is on this
          page rather than the connect page. Asking only after a connection (the
          connect page) reaches the scanner and no one else, which leaves the
          person whose code gets scanned permanently unsubscribed and silent. */}
      <div className="mt-8">
        <EnableNotifications
          title="Get notified the moment someone scans your code"
          body="You won't be looking at your phone when it happens — they scan, and you find out straight away with a one-tap prompt to save their contact."
        />
      </div>
    </main>
  );
}

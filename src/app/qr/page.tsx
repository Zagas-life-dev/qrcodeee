import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { connectUrl } from "@/lib/site";
import { normalizeQrStyle } from "@/lib/qr/style";

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
    .select("qr_token, qr_style")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
        <p className="text-sm opacity-70">We couldn&apos;t load your QR code.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your QR code</h1>
          <p className="mt-1 text-sm opacity-70">
            Show this to someone and have them scan it. You&apos;ll both be
            connected straight away — there&apos;s nothing to accept.
          </p>
        </div>
        <Link
          href="/preview"
          className="shrink-0 rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
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
        connectUrl={connectUrl(profile.qr_token)}
      />
    </main>
  );
}

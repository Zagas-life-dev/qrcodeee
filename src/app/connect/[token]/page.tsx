import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { sendPushToProfile } from "@/lib/push/send";
import { siteUrl } from "@/lib/site";
import type { ScanResult } from "@/lib/supabase/database.types";
import { ConnectedProfileCard } from "@/components/connected-profile-card";
import { EnableNotifications } from "@/components/enable-notifications";
import { SaveContactButton } from "@/components/save-contact-button";

export const metadata = { title: "Connecting · QR Connect" };

/**
 * Where a scanned QR code lands (§6). Everything the product does happens here:
 * one scan, mutual connection, no approval step.
 */
export default async function ConnectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // §5.1: an unauthenticated scanner must never be asked to scan again. The
  // token rides through login as `next` and the connection completes on return.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/connect/${token}`)}`);
  }

  const { data, error } = await supabase.rpc("connect_via_scan", {
    scanned_token: token,
  });

  if (error) {
    return (
      <Shell title="Something went wrong">
        <p className="text-sm opacity-70">
          We couldn&apos;t complete the connection. Please try scanning again.
        </p>
      </Shell>
    );
  }

  const result = data as ScanResult;

  // §5.2 step 3: the scanned person took no action and may not have the app
  // open, so Web Push is the only way to reach them. connect_via_scan already
  // wrote the notification row (§5.1); this is the delivery.
  //
  // The scanner's name is read here rather than inside after(), because after()
  // runs once the response is done and request-scoped cookie access is no longer
  // guaranteed. The push itself goes in after() so the scanner's screen never
  // waits on a round trip to a push service.
  if (result.status === "new_connection") {
    const scannedId = result.profile.id;
    const epoch = result.connection_epoch;
    const { data: me } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    after(async () => {
      // sendPushToProfile never throws, but the surrounding catch makes it
      // explicit that a delivery failure must not affect a connection that is
      // already committed — §5.2 step 4's reconcile-on-open covers the miss.
      try {
        await sendPushToProfile(scannedId, {
          title: "New connection",
          body: `${me?.name ?? "Someone"} connected with you. Save their contact so you don't lose it.`,
          url: `${siteUrl()}/connections`,
          // Per connection AND epoch: duplicates collapse, but a genuine
          // reconnect (§5.1) still surfaces as a new notification.
          tag: `connection:${scannedId}:${epoch}`,
        });
      } catch {
        // swallowed deliberately
      }
    });
  }

  switch (result.status) {
    case "self_scan":
      return (
        <Shell title="That's your own QR code">
          <p className="text-sm opacity-70">
            Show it to someone else and have them scan it.
          </p>
          <Actions />
        </Shell>
      );

    // Also the response when someone who has been blocked scans the blocker's
    // code. Deliberately indistinguishable from a genuinely expired token —
    // naming the block would disclose it to the person it was placed against.
    case "invalid_token":
      return (
        <Shell title="This QR code is no longer active">
          <p className="text-sm opacity-70">
            Ask them for their current one — codes change when someone resets
            theirs.
          </p>
          <Actions />
        </Shell>
      );

    case "blocked":
      return (
        <Shell title="You blocked this person">
          <p className="text-sm opacity-70">
            Unblock them from your connections if you want to connect.
          </p>
          <Actions />
        </Shell>
      );

    case "rate_limited":
      return (
        <Shell title="Slow down for a moment">
          <p className="text-sm opacity-70">
            You&apos;ve scanned a lot in a short space of time. Wait a minute and
            try again — nothing has gone wrong with your account.
          </p>
          <Actions />
        </Shell>
      );

    case "unauthenticated":
      redirect(`/login?next=${encodeURIComponent(`/connect/${token}`)}`);
      break;

    case "new_connection":
    case "already_connected":
      return (
        <Shell
          title={
            result.status === "new_connection"
              ? `You're now connected with ${result.profile.name}`
              : `You're already connected with ${result.profile.name}`
          }
        >
          <div className="mt-4">
            <ConnectedProfileCard profile={result.profile} />
          </div>

          <div className="mt-6">
            <SaveContactButton
              profileId={result.profile.id}
              name={result.profile.name}
            />
          </div>

          {/* §5.2: ask for notification permission right after a first
              successful connection, framed around the benefit — never on page
              load, which trains people to deny permanently. */}
          {result.status === "new_connection" ? <EnableNotifications /> : null}

          <Actions />
        </Shell>
      );
  }
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-3">{children}</div>
    </main>
  );
}

function Actions() {
  return (
    <div className="mt-8 flex flex-wrap gap-2">
      <Link
        href="/connections"
        className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
      >
        Your connections
      </Link>
      <Link
        href="/scan"
        className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
      >
        Scan another
      </Link>
    </div>
  );
}


import { redirect } from "next/navigation";

import { signInWithGoogle } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { SkanMark } from "@/components/brand";
import { CenteredPage } from "@/components/page";

const ERROR_COPY: Record<string, string> = {
  oauth_start: "We couldn't start the Google sign-in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next);

  const errorMessage = params.error ? ERROR_COPY[params.error] : undefined;

  // Deliberately plain: a scan that arrives logged-out lands here, so this is a
  // stranger's first impression of the product. Say what happens next.
  const isScanFlow = next.startsWith("/connect/");

  return (
    <CenteredPage>
      {/* The one screen that gets the full lockup at size. A scan that arrives
          logged-out lands here, so for a stranger this is the product's first
          impression and the only place the mark is the subject rather than
          chrome. The tile repeats the app icon they'd install. */}
      {/* Sized to REPRODUCE the installed app icon, not merely to echo it: the
          icon's plate is 76 units wide with a 22-unit corner (29%, so 16px on a
          56px tile) and its mark fills ~80% of that. Someone who installed the
          PWA should recognise this as the same object. */}
      <span className="mb-5 inline-flex size-14 items-center justify-center rounded-2xl border-2 border-ink bg-lilac shadow-brutal">
        <SkanMark className="size-12" />
      </span>
      <h1 className="font-display text-3xl leading-none tracking-tight">Skan QR</h1>
      <p className="mt-3 text-sm font-medium">
        {isScanFlow
          ? "Sign in to finish connecting — we'll pick up right where you left off."
          : "Share your contact details with a single scan."}
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-6 rounded-brutal border-2 border-ink bg-coral px-3 py-2 text-sm font-semibold"
        >
          {errorMessage}
        </p>
      ) : null}

      <form action={signInWithGoogle} className="mt-8">
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-full border-2 border-ink bg-lilac px-4 py-3 text-sm font-semibold shadow-brutal nb-press"
        >
          <GoogleMark />
          Continue with Google
        </button>
      </form>
    </CenteredPage>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

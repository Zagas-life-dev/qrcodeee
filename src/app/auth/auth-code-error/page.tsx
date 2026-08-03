import { Suspense } from "react";

import { ActionLink, CenteredPage } from "@/components/page";

/**
 * The card itself is static — the same words for everyone who lands here — and
 * only the diagnostic string comes from the URL. So the boundary goes around
 * just that, rather than a `loading.tsx` putting the whole page behind a
 * skeleton: the headline, the explanation and the way out all prerender and are
 * on screen immediately, which is what someone who has just failed to sign in
 * actually needs.
 */
export default function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  // Forwarded, never awaited here. Awaiting it in the page body is what would
  // make the whole route dynamic; passing the promise down lets the card
  // prerender and only <Reason> wait on the request.
  return (
    <CenteredPage>
      <h1 className="font-display text-2xl leading-tight tracking-tight">
        We couldn&apos;t finish signing you in
      </h1>
      <p className="mt-3 text-sm font-medium">
        The sign-in link expired or was already used. Starting over usually
        fixes it.
      </p>

      {/* No fallback: the reason is supplementary detail, and reserving space
          for something most visitors never see would leave a gap in the card. */}
      <Suspense fallback={null}>
        <Reason searchParams={searchParams} />
      </Suspense>

      <ActionLink href="/login" tone="primary" size="lg" className="mt-8">
        Back to sign in
      </ActionLink>
    </CenteredPage>
  );
}

async function Reason({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  if (!reason) return null;

  return (
    <p className="mt-4 rounded-brutal border-2 border-ink bg-canvas px-3 py-2 font-mono text-xs font-semibold wrap-break-word">
      {reason}
    </p>
  );
}

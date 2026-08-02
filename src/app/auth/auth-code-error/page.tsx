import { ActionLink, CenteredPage } from "@/components/page";

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <CenteredPage>
      <h1 className="font-display text-2xl leading-tight tracking-tight">
        We couldn&apos;t finish signing you in
      </h1>
      <p className="mt-3 text-sm font-medium">
        The sign-in link expired or was already used. Starting over usually
        fixes it.
      </p>
      {reason ? (
        <p className="mt-4 rounded-brutal border-2 border-ink bg-canvas px-3 py-2 font-mono text-xs font-semibold wrap-break-word">
          {reason}
        </p>
      ) : null}
      <ActionLink href="/login" tone="primary" size="lg" className="mt-8">
        Back to sign in
      </ActionLink>
    </CenteredPage>
  );
}

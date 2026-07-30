import Link from "next/link";

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-sm rounded-brutal border-2 border-ink bg-paper p-6 shadow-brutal-lg">
        <h1 className="font-display text-2xl leading-tight tracking-tight">
          We couldn&apos;t finish signing you in
        </h1>
        <p className="mt-3 text-sm font-medium">
          The sign-in link expired or was already used. Starting over usually
          fixes it.
        </p>
        {reason ? (
          <p className="mt-4 rounded-brutal border-2 border-ink bg-canvas px-3 py-2 font-mono text-xs font-bold wrap-break-word">
            {reason}
          </p>
        ) : null}
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-brutal border-2 border-ink bg-lemon px-4 py-2.5 text-sm font-bold shadow-brutal nb-press"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          We couldn&apos;t finish signing you in
        </h1>
        <p className="mt-2 text-sm opacity-70">
          The sign-in link expired or was already used. Starting over usually
          fixes it.
        </p>
        {reason ? (
          <p className="mt-4 rounded-md border border-current/15 px-3 py-2 font-mono text-xs opacity-60">
            {reason}
          </p>
        ) : null}
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-md border border-current/15 px-4 py-2 text-sm font-medium transition hover:bg-current/5"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

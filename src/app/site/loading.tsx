import { SkeletonCard } from "@/components/skeleton";

/**
 * Also this route's Suspense boundary — it reads the session (see app-shell.tsx).
 *
 * Mirrors the editor's real geometry rather than the old single column: a
 * toolbar strip, a centred canvas, and the inspector rail from `xl`. A skeleton
 * that shows one column and resolves into two is a layout jump on the slowest
 * screen in the app.
 */
export default function Loading() {
  return (
    <main
      role="status"
      aria-label="Loading"
      className="mx-auto w-full flex-1 px-4 pb-8 sm:px-6 sm:pb-10 lg:px-8"
    >
      <div className="-mx-4 border-b-2 border-ink bg-paper/60 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="h-11 w-48 animate-pulse rounded-brutal border-2 border-ink bg-paper" />
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="mx-auto w-full max-w-xl space-y-5">
          <SkeletonCard className="h-64" />
          <SkeletonCard className="h-64" />
        </div>
        <SkeletonCard className="hidden h-96 xl:block" />
      </div>
    </main>
  );
}

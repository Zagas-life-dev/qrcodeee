/**
 * Mirrors CenteredPage's geometry so the sign-in card doesn't jump on swap.
 *
 * Needed since Cache Components: this page reads `searchParams` and the session,
 * and runtime data outside a Suspense boundary blocks the whole route from
 * prerendering. `loading.tsx` IS that boundary — the page is dynamic end to end,
 * so a route-level fallback is the honest granularity here rather than trying to
 * carve a static shell out of a single card.
 */
export default function Loading() {
  return (
    <main
      role="status"
      aria-label="Loading"
      className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="w-full max-w-sm rounded-brutal-lg border-2 border-ink bg-paper p-6 shadow-brutal-lg">
        <div className="mb-5 size-14 animate-pulse rounded-2xl border-2 border-ink bg-canvas shadow-brutal" />
        <div className="h-8 w-40 animate-pulse rounded-brutal bg-canvas" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full animate-pulse rounded-full bg-canvas" />
          <div className="h-3 w-3/5 animate-pulse rounded-full bg-canvas" />
        </div>
        <div className="mt-8 h-12 w-full animate-pulse rounded-full border-2 border-ink bg-canvas shadow-brutal" />
      </div>
    </main>
  );
}

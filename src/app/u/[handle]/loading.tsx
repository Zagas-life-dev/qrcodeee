import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

/**
 * The public profile's route-level Suspense boundary.
 *
 * Required because the page awaits `params`, which on a dynamic segment with no
 * `generateStaticParams` is uncached runtime data — so without a boundary the
 * route refuses to prerender at all. That this also covers `resolveHandle` is
 * incidental; that call is `use cache` and would have been legal on its own.
 *
 * Its cost is documented at length in page.tsx: the shell flushes 200, so a
 * missing handle is a soft 404. Kept anyway because the alternative is a route
 * that will not build, and because every page here is `noindex` today.
 *
 * Deliberately the same shape as the page's own <ProfileSkeleton>, so the two
 * stages — waiting on the handle, then waiting on the viewer — read as one
 * continuous loading state rather than two different screens.
 */
export default function Loading() {
  return (
    // The page's own container is `lg` so that a bento band has room; its card
    // and actions are capped at `md` inside it. Both have to be mirrored here or
    // the card jumps left the moment the real page arrives.
    <SkeletonPage width="max-w-lg xl:max-w-2xl">
      <div className="max-w-md">
        <SkeletonTitle />
        <div className="mt-6">
          <SkeletonCard className="h-72" />
        </div>
        <div className="mt-8">
          <SkeletonCard className="h-32" />
        </div>
      </div>
    </SkeletonPage>
  );
}

import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

/**
 * One connection. Mirrors the real page: name, hero card, save button, Manage.
 *
 * Also the Suspense boundary Cache Components requires — this page reads both
 * `searchParams` (the `?new=1` live-encounter flag) and the session, and runtime
 * data outside a boundary blocks the route from prerendering.
 */
export default function Loading() {
  return (
    <SkeletonPage width="max-w-md">
      <div className="mb-5 h-5 w-28 animate-pulse rounded-full bg-paper" />
      <SkeletonTitle />
      <div className="mt-6">
        <SkeletonCard className="h-72" />
      </div>
      <div className="mt-6">
        <SkeletonCard className="h-14" />
      </div>
      <div className="mt-10">
        <SkeletonCard className="h-12" />
      </div>
    </SkeletonPage>
  );
}

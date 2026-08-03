import { SkeletonPage, SkeletonTitle } from "@/components/skeleton";

/**
 * The camera frame is the page, so the skeleton is one tall surface rather than
 * a stack of cards. Its boundary role is the same as every other loading.tsx
 * added for Cache Components: this page reads the session, and that has to sit
 * inside a Suspense boundary or it blocks the route from prerendering.
 */
export default function Loading() {
  return (
    <SkeletonPage width="max-w-md">
      <SkeletonTitle />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-4/5 animate-pulse rounded-full bg-paper" />
      </div>
      {/* Matches the scanner's square viewport, so the live feed lands in the
          same box the placeholder occupied. */}
      <div className="mt-6 aspect-square w-full animate-pulse rounded-brutal border-2 border-ink bg-paper shadow-brutal" />
    </SkeletonPage>
  );
}

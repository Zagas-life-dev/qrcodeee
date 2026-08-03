import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

/**
 * The moment after a scan, before connect_via_scan answers.
 *
 * This one earns its skeleton more than most: the page is doing a round trip
 * that WRITES (§5.1), and it is the first thing a stranger sees after scanning a
 * printed code. A frozen previous screen here reads as a failed scan, and the
 * usual response to a failed scan is to scan again.
 *
 * It is also the Suspense boundary Cache Components requires. Worth knowing why
 * that is safe on a mutating route: the page reads the session BEFORE it calls
 * connect_via_scan, so prerendering stops at the cookie read and the RPC can
 * only ever run at request time. Keep that order.
 */
export default function Loading() {
  return (
    <SkeletonPage width="max-w-md">
      <SkeletonTitle />
      <div className="mt-4">
        <SkeletonCard className="h-72" />
      </div>
      <div className="mt-6">
        <SkeletonCard className="h-14" />
      </div>
    </SkeletonPage>
  );
}

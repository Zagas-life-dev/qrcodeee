import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonTitle />
      {/* Same grid as the real KPI row and chart pair, so the swap doesn't
          reflow the page under whatever the reader is already looking at. */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SkeletonCard className="h-52" />
        <SkeletonCard className="h-52" />
      </div>
    </SkeletonPage>
  );
}

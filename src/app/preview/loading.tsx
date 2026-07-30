import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTitle />
      <SkeletonCard className="mt-6 h-44" />
      <div className="mt-10 space-y-3">
        <SkeletonCard className="h-24" />
        <SkeletonCard className="h-24" />
        <SkeletonCard className="h-24" />
      </div>
    </SkeletonPage>
  );
}

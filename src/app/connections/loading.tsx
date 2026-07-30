import { SkeletonPage, SkeletonRows, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTitle />
      <div className="mt-4 h-12 w-full animate-pulse rounded-brutal border-2 border-ink bg-paper shadow-brutal-sm" />
      <SkeletonRows count={6} />
    </SkeletonPage>
  );
}

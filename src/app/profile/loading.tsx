import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTitle />
      <div className="mt-8 flex items-center gap-4">
        <div className="size-20 shrink-0 animate-pulse rounded-full border-2 border-ink bg-paper shadow-brutal" />
        <div className="h-11 w-36 animate-pulse rounded-brutal border-2 border-ink bg-paper shadow-brutal-sm" />
      </div>
      <div className="mt-8 space-y-6">
        <SkeletonCard className="h-16" />
        <SkeletonCard className="h-24" />
        <SkeletonCard className="h-56" />
      </div>
    </SkeletonPage>
  );
}

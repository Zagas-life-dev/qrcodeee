import { SkeletonCard, SkeletonPage, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-3xl">
      <SkeletonTitle />
      <div className="mt-8 grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* 288px + 2×12px padding — the exact footprint qr-code-styling renders
            into, so the code doesn't shunt the controls when it appears. */}
        <SkeletonCard className="size-[312px] max-w-full" />
        <SkeletonCard className="h-64" />
      </div>
    </SkeletonPage>
  );
}

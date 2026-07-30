import { SkeletonPage, SkeletonRows, SkeletonTitle } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTitle />
      <SkeletonRows count={3} />
    </SkeletonPage>
  );
}

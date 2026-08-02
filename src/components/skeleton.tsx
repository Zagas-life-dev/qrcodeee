/**
 * Route-level loading skeletons.
 *
 * These exist because of how this app is built, not as decoration. Every page is
 * a Server Component that awaits Supabase before it can render anything, so a
 * navigation with no `loading.tsx` leaves the previous screen frozen under a
 * tapped tab until the round trip lands — which on conference wifi is exactly
 * the moment the app feels broken. A `loading.tsx` turns that into an immediate
 * response: the tab lights up, the shell stays put, and the page's own shape
 * appears at once.
 *
 * They mirror the real layout's geometry rather than being generic grey bars, so
 * the swap to real content doesn't jump. The outline and hard shadow stay at
 * full strength while only the fill pulses — a skeleton that fades its border
 * too reads as a rendering bug in a system where every surface has one.
 */

/** Matches the `<main>` wrapper every page uses, so nothing shifts on swap. */
export function SkeletonPage({
  width = "max-w-lg",
  children,
}: {
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      // Announced rather than silent: a screen reader otherwise gets no signal
      // that anything is happening between the tap and the content.
      role="status"
      aria-label="Loading"
      className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${width}`}
    >
      {children}
    </main>
  );
}

export function SkeletonTitle() {
  return (
    <div className="h-8 w-44 animate-pulse rounded-brutal border-2 border-ink bg-paper" />
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-brutal border-2 border-ink bg-paper shadow-brutal ${className}`}
    />
  );
}

/** A connections / notifications / blocked row: avatar, two lines, an action. */
export function SkeletonRow() {
  return (
    <li className="flex items-center gap-3 rounded-brutal border-2 border-ink bg-paper p-3 shadow-brutal">
      <div className="size-10 shrink-0 animate-pulse rounded-full border-2 border-ink bg-canvas" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-canvas" />
        <div className="h-2.5 w-3/5 animate-pulse rounded-full bg-canvas" />
      </div>
      <div className="h-9 w-20 shrink-0 animate-pulse rounded-full border-2 border-ink bg-canvas" />
    </li>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <ul className="mt-6 space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </ul>
  );
}

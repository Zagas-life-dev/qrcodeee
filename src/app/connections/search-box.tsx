"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Debounced search over connection history.
 *
 * Debounced rather than search-as-you-type-per-keystroke: each search is a
 * database round trip through an RPC, and firing one per keypress turns a
 * ten-character name into ten queries per user.
 */
export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (value === initialQuery) return;

    const timer = setTimeout(() => {
      const search = new URLSearchParams();
      if (value.trim()) search.set("q", value.trim());
      // Any new search resets to page 1 — staying on page 4 of a result set that
      // no longer has four pages shows an empty list for no visible reason.
      startTransition(() => router.push(`/connections?${search}`));
    }, 300);

    return () => clearTimeout(timer);
  }, [value, initialQuery, router]);

  return (
    <div className="relative mt-4">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by name"
        aria-label="Search your connections"
        className="min-h-12 w-full rounded-brutal border-2 border-ink bg-paper px-3 text-base font-medium shadow-brutal-sm sm:text-sm"
      />
      {isPending ? (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full border-2 border-ink bg-lemon px-2 py-0.5 text-xs font-bold">
          Searching…
        </span>
      ) : null}
    </div>
  );
}

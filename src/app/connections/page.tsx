import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ConnectionActions } from "@/components/connection-actions";
import { SaveContactButton } from "@/components/save-contact-button";

import { SearchBox } from "./search-box";

export const metadata = { title: "Connections · QR Connect" };

const PAGE_SIZE = 25;

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const query = (params.q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/connections");

  // One round trip for the page, the search and the total. The RPC runs
  // SECURITY INVOKER, so the connections and profiles policies (§4) do the
  // filtering — this page contains no authorization logic of its own.
  //
  // §1: a LIVE POINTER, not a snapshot. Names and photos are read fresh, so
  // someone who updates their profile shows updated here.
  const { data: rows, error } = await supabase.rpc("search_connections", {
    p_query: query || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  const results = rows ?? [];
  const total = Number(results[0]?.total_count ?? 0);
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl leading-none tracking-tight">
          Connections
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {total > 0 ? (
            <span className="rounded-full border-2 border-ink bg-lime px-2.5 py-0.5 text-xs font-bold tabular-nums">
              {total} {total === 1 ? "person" : "people"}
            </span>
          ) : null}
          <Link
            href="/blocked"
            className="flex min-h-9 items-center rounded-full border-2 border-ink bg-paper px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm"
          >
            Blocked
          </Link>
        </div>
      </div>

      <SearchBox initialQuery={query} />

      {error ? (
        <p className="mt-6 rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-bold shadow-brutal">
          We couldn&apos;t load your connections.
        </p>
      ) : results.length === 0 ? (
        <div className="mt-6 rounded-brutal border-2 border-dashed border-ink px-4 py-10 text-center">
          {query ? (
            <p className="text-sm font-bold">Nobody matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <>
              <p className="text-sm font-bold">You haven&apos;t connected with anyone yet.</p>
              <Link
                href="/scan"
                className="mt-4 inline-flex rounded-brutal border-2 border-ink bg-lemon px-4 py-2 text-sm font-bold shadow-brutal nb-press"
              >
                Scan a code
              </Link>
            </>
          )}
        </div>
      ) : (
        // Discrete cards rather than divider rules: a hairline divider is the
        // soft-depth idiom this language replaces, and every row here already
        // carries two controls that need a surface to sit on.
        <ul className="mt-6 space-y-3">
          {results.map((row) => {
            // §8: a deleted account keeps its connection and renders as a
            // placeholder rather than a broken reference.
            const deleted = row.deleted_at != null;
            return (
              <li
                key={row.connection_id}
                className={`flex items-center gap-3 rounded-brutal border-2 border-ink p-3 shadow-brutal ${
                  // §8: a deleted account is still a real row, so it keeps its
                  // border and shadow and loses only its fill — the one place
                  // this palette steps down instead of across.
                  deleted ? "bg-canvas" : "bg-paper"
                }`}
              >
                {row.photo_url && !deleted ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.photo_url}
                    alt=""
                    className="size-10 shrink-0 rounded-full border-2 border-ink object-cover"
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lilac font-display text-sm">
                    {deleted ? "—" : row.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm">{row.name}</p>
                  <p className="text-xs font-medium text-ink/70">
                    Connected{" "}
                    {new Date(row.connected_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>

                {!deleted ? (
                  <SaveContactButton
                    profileId={row.profile_id}
                    name={row.name}
                    className="min-h-11 shrink-0 rounded-brutal border-2 border-ink bg-lime px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
                  />
                ) : null}

                <ConnectionActions
                  connectionId={row.connection_id}
                  profileId={row.profile_id}
                  name={deleted ? "this deleted account" : row.name}
                />
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <PageLink page={page - 1} query={query}>
              Previous
            </PageLink>
          ) : (
            <span />
          )}
          <span className="font-bold tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <PageLink page={page + 1} query={query}>
              Next
            </PageLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

function PageLink({
  page, query, children,
}: { page: number; query: string; children: React.ReactNode }) {
  const search = new URLSearchParams({ page: String(page) });
  if (query) search.set("q", query);
  return (
    <Link
      href={`/connections?${search}`}
      className="rounded-brutal border-2 border-ink bg-paper px-3 py-1.5 font-bold shadow-brutal-sm nb-press-sm"
    >
      {children}
    </Link>
  );
}

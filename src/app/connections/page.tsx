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
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <div className="flex shrink-0 items-center gap-3">
          {total > 0 ? (
            <span className="text-xs opacity-60">
              {total} {total === 1 ? "person" : "people"}
            </span>
          ) : null}
          <Link
            href="/blocked"
            className="text-xs opacity-60 underline-offset-2 transition hover:opacity-100 hover:underline"
          >
            Blocked
          </Link>
        </div>
      </div>

      <SearchBox initialQuery={query} />

      {error ? (
        <p className="mt-6 text-sm opacity-70">We couldn&apos;t load your connections.</p>
      ) : results.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-current/20 px-4 py-8 text-center">
          {query ? (
            <p className="text-sm opacity-70">
              Nobody matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <>
              <p className="text-sm opacity-70">You haven&apos;t connected with anyone yet.</p>
              <Link
                href="/scan"
                className="mt-4 inline-flex rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
              >
                Scan a code
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-current/10">
          {results.map((row) => {
            // §8: a deleted account keeps its connection and renders as a
            // placeholder rather than a broken reference.
            const deleted = row.deleted_at != null;
            return (
              <li key={row.connection_id} className="flex items-center gap-3 py-3">
                {row.photo_url && !deleted ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.photo_url} alt="" className="size-10 rounded-full object-cover" />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-full border border-current/15 text-sm opacity-40">
                    {deleted ? "—" : row.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${deleted ? "opacity-50" : ""}`}>
                    {row.name}
                  </p>
                  <p className="text-xs opacity-50">
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
                    className="shrink-0 rounded-md border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5 disabled:opacity-50"
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
          <span className="opacity-60">
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
      className="rounded-md border border-current/15 px-3 py-1.5 transition hover:bg-current/5"
    >
      {children}
    </Link>
  );
}

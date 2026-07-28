import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ConnectionActions } from "@/components/connection-actions";
import { SaveContactButton } from "@/components/save-contact-button";

import { SearchBox } from "./search-box";

export const metadata = { title: "Connections · QR Connect" };

const PAGE_SIZE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; save?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const query = (params.q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/connections");

  // §5.2 step 3: arriving from a Web Push notification must land on the
  // save-contact prompt for the person the notification was about — not on a
  // list the user then has to search. `save` is a URL param, so it is untrusted
  // and gets the same connection check the vCard endpoint applies; without it,
  // any id would render a stranger's name back to the caller.
  const saveTarget = await resolveSaveTarget(supabase, params.save);

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

      {/* The whole point of the notification, hoisted above the list and
          focused. Still a tap, never a silent write — §5.2 point 3 and §10 are
          explicit that the web cannot confirm (or perform) a contact write, so
          this presents the OS prompt rather than claiming to have saved. */}
      {saveTarget ? (
        <div className="mt-6 rounded-lg border border-current/25 bg-current/3 p-4">
          <p className="text-sm font-medium">
            You connected with {saveTarget.name}
          </p>
          <p className="mt-1 text-sm opacity-70">
            Save their contact so you don&apos;t lose it.
          </p>
          <div className="mt-3">
            <SaveContactButton
              profileId={saveTarget.id}
              name={saveTarget.name}
              autoFocus
            >
              Save {saveTarget.name}&apos;s contact
            </SaveContactButton>
          </div>
        </div>
      ) : null}

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

/**
 * Resolves `?save=<profileId>` to a person worth prompting about, or null.
 *
 * Returns null rather than throwing for every rejection — a stale push opened a
 * week after the connection was removed should quietly show the normal list, not
 * an error. §8: a deleted account has no card worth writing to an address book,
 * so it is filtered here as well as at the vCard endpoint.
 */
async function resolveSaveTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string | undefined,
): Promise<{ id: string; name: string } | null> {
  // Validated before it reaches the filter string below, not merely because a
  // non-UUID can't match: `.or()` takes PostgREST filter SYNTAX, so an
  // unvalidated value here is interpolated into a query language, with commas
  // and dots as its metacharacters.
  if (!profileId || !UUID.test(profileId)) return null;

  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .or(`user_a.eq.${profileId},user_b.eq.${profileId}`)
    .maybeSingle();
  if (!connection) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, deleted_at")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return null;

  return { id: profileId, name: profile.name };
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

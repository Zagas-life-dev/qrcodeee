import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SaveContactButton } from "@/components/save-contact-button";

export const metadata = { title: "Connections · QR Connect" };

const PAGE_SIZE = 25;

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/connections");

  // The SELECT policy already restricts this to the caller's own ACTIVE,
  // unblocked connections (§4) — there is no filtering to do here, and adding
  // any would just duplicate the policy badly.
  const {
    data: connections,
    count,
    error,
  } = await supabase
    .from("connections")
    .select("id, connected_at, user_a, user_b", { count: "exact" })
    .order("connected_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    return (
      <Shell page={page} total={0}>
        <p className="text-sm opacity-70">We couldn&apos;t load your connections.</p>
      </Shell>
    );
  }

  const rows = connections ?? [];
  const otherIds = rows.map((c) => (c.user_a === user.id ? c.user_b : c.user_a));

  // Second query rather than a PostgREST embed: `connections` has two foreign
  // keys to `profiles`, so an embed needs per-FK hint syntax and still returns
  // the wrong side half the time — user_a/user_b are stored as-scanned and are
  // deliberately not normalised (§3, §5.4).
  //
  // §1: this is a LIVE POINTER, not a snapshot. Names and photos are read fresh
  // every time, so someone who updates their profile is shown updated here —
  // nothing about the scan is frozen into the connection row.
  const { data: profiles } = otherIds.length
    ? await supabase
        .from("profiles")
        .select("id, name, photo_url, deleted_at")
        .in("id", otherIds)
    : { data: [] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const total = count ?? 0;

  return (
    <Shell page={page} total={total}>
      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-current/20 px-4 py-8 text-center">
          <p className="text-sm opacity-70">You haven&apos;t connected with anyone yet.</p>
          <Link
            href="/scan"
            className="mt-4 inline-flex rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
          >
            Scan a code
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-current/10">
          {rows.map((connection) => {
            const other = byId.get(
              connection.user_a === user.id ? connection.user_b : connection.user_a,
            );
            // §8: a deleted account keeps its connection row and renders as a
            // placeholder rather than a broken reference. The profiles row stays
            // readable precisely so this resolves to something.
            const deleted = other?.deleted_at != null;
            const name = deleted ? "Deleted account" : (other?.name ?? "Unknown");

            return (
              <li key={connection.id} className="flex items-center gap-3 py-3">
                {other?.photo_url && !deleted ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={other.photo_url} alt="" className="size-10 rounded-full object-cover" />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-full border border-current/15 text-sm opacity-40">
                    {deleted ? "—" : name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${deleted ? "opacity-50" : ""}`}>
                    {name}
                  </p>
                  <p className="text-xs opacity-50">
                    Connected{" "}
                    {new Date(connection.connected_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>

                {/* Re-savable on purpose: the card is rebuilt from the profile as
                    it is now, so someone whose number changed can be saved again
                    with the new one (§1, §5.7). A deleted account has nothing
                    worth writing to an address book. */}
                {!deleted && other ? (
                  <SaveContactButton
                    profileId={other.id}
                    name={other.name}
                    className="shrink-0 rounded-md border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5 disabled:opacity-50"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} total={total} />
    </Shell>
  );
}

function Shell({
  page, total, children,
}: { page: number; total: number; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        {total > 0 ? (
          <span className="text-xs opacity-60">
            {total} {total === 1 ? "person" : "people"}
          </span>
        ) : null}
      </div>
      {children}
      <span className="sr-only">Page {page}</span>
    </main>
  );
}

function Pagination({ page, total }: { page: number; total: number }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
      {page > 1 ? (
        <Link href={`/connections?page=${page - 1}`} className="rounded-md border border-current/15 px-3 py-1.5 transition hover:bg-current/5">
          Previous
        </Link>
      ) : <span />}
      <span className="opacity-60">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={`/connections?page=${page + 1}`} className="rounded-md border border-current/15 px-3 py-1.5 transition hover:bg-current/5">
          Next
        </Link>
      ) : <span />}
    </nav>
  );
}

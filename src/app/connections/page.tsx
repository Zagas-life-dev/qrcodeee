import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ConnectionActions } from "@/components/connection-actions";
import { SaveContactButton } from "@/components/save-contact-button";
import { AnimatedList, AnimatedListItem } from "@/components/animated-list";
import {
  ActionLink,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  Pill,
  actionClass,
} from "@/components/page";

import { SearchBox } from "./search-box";

export const metadata = { title: "Connections · Skan QR" };

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
    <Page>
      <PageHeader
        title="Connections"
        actions={
          <>
            {total > 0 ? (
              <Pill tone="ok" className="tabular-nums">
                {total} {total === 1 ? "person" : "people"}
              </Pill>
            ) : null}
            <ActionLink href="/blocked" size="sm" className="rounded-full">
              Blocked
            </ActionLink>
          </>
        }
      />

      <SearchBox initialQuery={query} />

      {error ? (
        <Notice tone="error" className="mt-6">
          We couldn&apos;t load your connections.
        </Notice>
      ) : results.length === 0 ? (
        <div className="mt-6">
          {query ? (
            <EmptyState>Nobody matches &ldquo;{query}&rdquo;.</EmptyState>
          ) : (
            <EmptyState
              action={
                <ActionLink href="/scan" tone="primary" size="lg">
                  Scan a code
                </ActionLink>
              }
            >
              You haven&apos;t connected with anyone yet.
            </EmptyState>
          )}
        </div>
      ) : (
        // Discrete cards rather than divider rules: a hairline divider is the
        // soft-depth idiom this language replaces, and every row here already
        // carries two controls that need a surface to sit on.
        <AnimatedList className="mt-6 space-y-3">
          {results.map((row, index) => {
            // §8: a deleted account keeps its connection and renders as a
            // placeholder rather than a broken reference.
            const deleted = row.deleted_at != null;
            return (
              <AnimatedListItem
                key={row.connection_id}
                index={index}
                className={`nb-row flex items-center gap-3 rounded-brutal border-2 border-ink p-3 shadow-brutal ${
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
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sky font-display text-sm">
                    {deleted ? "—" : row.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  {/* The whole card opens the person (nb-row / nb-stretch), but
                      only the name is the actual anchor — a link may not wrap
                      the Save and ••• controls beside it. §8: a deleted account
                      has no page worth opening, so its row stays inert. */}
                  {deleted ? (
                    <p className="truncate font-display text-sm">{row.name}</p>
                  ) : (
                    <Link
                      href={`/connections/${row.profile_id}`}
                      className="nb-stretch block truncate font-display text-sm"
                    >
                      {row.name}
                    </Link>
                  )}
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
                    className={actionClass({
                      tone: "positive",
                      size: "sm",
                      className: "nb-above shrink-0",
                    })}
                  />
                ) : null}

                <span className="nb-above shrink-0">
                  <ConnectionActions
                    connectionId={row.connection_id}
                    profileId={row.profile_id}
                    name={deleted ? "this deleted account" : row.name}
                  />
                </span>
              </AnimatedListItem>
            );
          })}
        </AnimatedList>
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
          <span className="font-semibold tabular-nums">
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
    </Page>
  );
}

function PageLink({
  page, query, children,
}: { page: number; query: string; children: React.ReactNode }) {
  const search = new URLSearchParams({ page: String(page) });
  if (query) search.set("q", query);
  return (
    <ActionLink href={`/connections?${search}`}>{children}</ActionLink>
  );
}

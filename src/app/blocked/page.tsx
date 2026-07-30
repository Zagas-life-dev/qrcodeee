import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ActionLink, EmptyState, Notice, Page, PageHeader } from "@/components/page";

import { UnblockButton } from "./unblock-button";

export const metadata = { title: "Blocked · QR Connect" };

export default async function BlockedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/blocked");

  // Via the RPC, not a join. Blocking someone also hides their profile FROM the
  // blocker (the profiles policy checks is_blocked in both directions), so a
  // normal query here returns UUIDs with no names attached — and no way to tell
  // whom you're unblocking.
  const { data: blocked, error } = await supabase.rpc("list_blocked");

  return (
    <Page>
      <PageHeader
        title="Blocked"
        description="Blocking hides you from each other completely and stops either of you reconnecting. Your connection isn't deleted — unblocking brings it back."
      />

      {error ? (
        <Notice tone="error" className="mt-6">
          We couldn&apos;t load your block list.
        </Notice>
      ) : (blocked ?? []).length === 0 ? (
        <div className="mt-6">
          <EmptyState>You haven&apos;t blocked anyone.</EmptyState>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {(blocked ?? []).map((person) => (
            <li
              key={person.profile_id}
              className="flex items-center gap-3 rounded-brutal border-2 border-ink bg-paper p-3 shadow-brutal"
            >
              {person.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={person.photo_url}
                  alt=""
                  className="size-10 shrink-0 rounded-full border-2 border-ink object-cover"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lilac font-display text-sm">
                  {person.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm">{person.name}</p>
                <p className="text-xs font-medium text-ink/70">
                  Blocked{" "}
                  {new Date(person.blocked_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <UnblockButton profileId={person.profile_id} name={person.name} />
            </li>
          ))}
        </ul>
      )}

      <ActionLink href="/connections" className="mt-8">
        Your connections
      </ActionLink>
    </Page>
  );
}

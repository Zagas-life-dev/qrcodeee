import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Blocked</h1>
      <p className="mt-1 text-sm opacity-70">
        Blocking hides you from each other completely and stops either of you
        reconnecting. Your connection isn&apos;t deleted — unblocking brings it
        back.
      </p>

      {error ? (
        <p className="mt-6 text-sm opacity-70">We couldn&apos;t load your block list.</p>
      ) : (blocked ?? []).length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-current/20 px-4 py-8 text-center text-sm opacity-70">
          You haven&apos;t blocked anyone.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-current/10">
          {(blocked ?? []).map((person) => (
            <li key={person.profile_id} className="flex items-center gap-3 py-3">
              {person.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={person.photo_url} alt="" className="size-10 rounded-full object-cover" />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full border border-current/15 text-sm opacity-40">
                  {person.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{person.name}</p>
                <p className="text-xs opacity-50">
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

      <Link
        href="/connections"
        className="mt-8 inline-flex rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
      >
        Your connections
      </Link>
    </main>
  );
}

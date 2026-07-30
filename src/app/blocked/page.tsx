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
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl leading-none tracking-tight">Blocked</h1>
      <p className="mt-3 text-sm font-medium">
        Blocking hides you from each other completely and stops either of you
        reconnecting. Your connection isn&apos;t deleted — unblocking brings it
        back.
      </p>

      {error ? (
        <p className="mt-6 rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-bold shadow-brutal">
          We couldn&apos;t load your block list.
        </p>
      ) : (blocked ?? []).length === 0 ? (
        <p className="mt-6 rounded-brutal border-2 border-dashed border-ink px-4 py-10 text-center text-sm font-bold">
          You haven&apos;t blocked anyone.
        </p>
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

      <Link
        href="/connections"
        className="mt-8 inline-flex rounded-brutal border-2 border-ink bg-paper px-3 py-2 text-sm font-bold shadow-brutal-sm nb-press-sm"
      >
        Your connections
      </Link>
    </main>
  );
}

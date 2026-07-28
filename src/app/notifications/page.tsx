import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { notificationText, relativeTime } from "@/lib/notifications/display";
import type { NotificationType } from "@/lib/supabase/database.types";
import { SaveContactButton } from "@/components/save-contact-button";

import { MarkAllReadButton, MarkOnOpen } from "./actions-client";

export const metadata = { title: "Notifications · QR Connect" };

const PAGE_SIZE = 30;

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, type, source_profile_id, change_version, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const notifications = rows ?? [];
  const sourceIds = [...new Set(notifications.map((n) => n.source_profile_id))];

  // Names are resolved fresh at render (§1: live pointer, §5.4 point 4). A
  // notification about someone who has since renamed shows the current name.
  const { data: profiles } = sourceIds.length
    ? await supabase.from("profiles").select("id, name, deleted_at").in("id", sourceIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        {unreadIds.length > 0 ? <MarkAllReadButton /> : null}
      </div>

      {/* Opening the list marks what's on screen read (§5.5). */}
      <MarkOnOpen ids={unreadIds} />

      {notifications.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-current/20 px-4 py-8 text-center text-sm opacity-70">
          Nothing yet. You&apos;ll hear from us when someone you&apos;re
          connected with updates their details.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-current/10">
          {notifications.map((notification) => {
            const source = byId.get(notification.source_profile_id);
            const deleted = source?.deleted_at != null;
            const name = deleted ? "A deleted account" : (source?.name ?? "Someone");
            const copy = notificationText(notification.type as NotificationType, name);

            return (
              <li
                key={notification.id}
                className={`flex gap-3 py-4 ${notification.read_at ? "opacity-60" : ""}`}
              >
                {!notification.read_at ? (
                  <span
                    aria-label="Unread"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500"
                  />
                ) : (
                  <span className="mt-1.5 size-2 shrink-0" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{copy.title}</p>
                  <p className="mt-0.5 text-sm opacity-70">{copy.body}</p>
                  <p className="mt-1 text-xs opacity-50">
                    {relativeTime(notification.created_at)}
                  </p>

                  {/* §5.7: one-tap "update phone contact" off a change
                      notification, rather than making the user redo it from
                      scratch. Not offered for a deleted account — that card
                      would overwrite a good address book entry with a
                      placeholder. */}
                  {!deleted && source ? (
                    <div className="mt-2">
                      <SaveContactButton
                        profileId={source.id}
                        name={source.name}
                        className="rounded-md border border-current/15 px-2.5 py-1 text-xs transition hover:bg-current/5 disabled:opacity-50"
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
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

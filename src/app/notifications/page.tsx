import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { notificationText, relativeTime } from "@/lib/notifications/display";
import type { NotificationType } from "@/lib/supabase/database.types";
import { SaveContactButton } from "@/components/save-contact-button";
import { ActionLink, EmptyState, Page, PageHeader } from "@/components/page";

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
    <Page>
      <PageHeader
        title="Notifications"
        actions={unreadIds.length > 0 ? <MarkAllReadButton /> : undefined}
      />

      {/* Opening the list marks what's on screen read (§5.5). */}
      <MarkOnOpen ids={unreadIds} />

      {notifications.length === 0 ? (
        <div className="mt-8">
          <EmptyState>
            Nothing yet. You&apos;ll hear from us when someone you&apos;re
            connected with updates their details.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {notifications.map((notification) => {
            const source = byId.get(notification.source_profile_id);
            const deleted = source?.deleted_at != null;
            const name = deleted ? "A deleted account" : (source?.name ?? "Someone");
            const copy = notificationText(notification.type as NotificationType, name);

            return (
              // Read/unread is carried by the FILL, not by opacity: fading a
              // card on a yellow canvas just makes it muddier, and the sky fill
              // reads as "new" down a list at a glance.
              <li
                key={notification.id}
                className={`flex gap-3 rounded-brutal border-2 border-ink p-3 shadow-brutal ${
                  notification.read_at ? "bg-paper" : "bg-sky"
                }`}
              >
                {!notification.read_at ? (
                  <span
                    aria-label="Unread"
                    className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-ink bg-coral"
                  />
                ) : (
                  <span className="mt-1.5 size-2.5 shrink-0" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm">{copy.title}</p>
                  <p className="mt-1 text-sm font-medium">{copy.body}</p>
                  <p className="mt-1.5 text-xs font-bold text-ink/70">
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
                        className="min-h-10 rounded-brutal border-2 border-ink bg-paper px-3.5 text-xs font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ActionLink href="/connections" className="mt-8">
        Your connections
      </ActionLink>
    </Page>
  );
}

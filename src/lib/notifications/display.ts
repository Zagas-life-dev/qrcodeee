import type { NotificationType } from "@/lib/supabase/database.types";

/**
 * Notification copy, generated at RENDER time from the structured row (§5.4
 * point 4) — never stored. A stored string means a wording change leaves every
 * old notification with stale copy baked in, and it would freeze the source's
 * name at the moment of the event, which contradicts the live-pointer rule (§1).
 */
export function notificationText(
  type: NotificationType,
  name: string,
): { title: string; body: string } {
  switch (type) {
    case "new_connection":
      // "connected with", never "friend request" or "follow" — those imply an
      // approval step this product doesn't have (§1).
      return {
        title: `You connected with ${name}`,
        body: "Save their contact so you don't lose it.",
      };

    case "major_change":
      // Says that contact info changed, NOT which field. The change event
      // records field names only and the notification row doesn't carry them at
      // all — claiming more would be inventing detail.
      return {
        title: `${name} updated their contact info`,
        body: "Your saved contact may be out of date.",
      };

    case "accumulated_changes":
      // Deliberately vaguer than major_change. This type exists precisely so the
      // app can say "updated their profile" without implying a phone number or
      // email changed — that distinction is the whole reason it's a separate type.
      return {
        title: `${name} updated their profile`,
        body: "Photo, bio or other details have changed.",
      };
  }
}

/** Compact relative time — "2h ago" reads better than a date in a dropdown. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

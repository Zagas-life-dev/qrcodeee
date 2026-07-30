import type { ScannedProfile } from "@/lib/supabase/database.types";

/**
 * A profile as a CONNECTION sees it.
 *
 * Shared by /connect/[token] and /preview on purpose. A preview built from its
 * own markup is a preview that drifts: add a field to one and forget the other,
 * and the app starts confidently showing people something different from what
 * their connections actually get. Same component, same shape, no drift possible.
 *
 * The shape is `ScannedProfile` — exactly what connect_via_scan returns — so the
 * preview is also pinned to the real payload rather than to a hand-assembled
 * approximation of it.
 */
export function ConnectedProfileCard({ profile }: { profile: ScannedProfile }) {
  return (
    <div className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
      <div className="flex items-center gap-3">
        {profile.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photo_url}
            alt=""
            className="size-14 shrink-0 rounded-full border-2 border-ink object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lilac font-display text-lg">
            {profile.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight">{profile.name}</p>
          {profile.bio ? (
            <p className="truncate text-sm font-medium">{profile.bio}</p>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 space-y-2 border-t-2 border-ink pt-4 text-sm">
        <Row label="Phone" value={profile.phone} />
        <Row label="Email" value={profile.email} />
        {profile.custom_fields.map((field) => (
          <Row key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>
    </div>
  );
}

/**
 * §1: a missing or removed field renders as "Not provided", never as an error.
 * Connection history is a live pointer, so fields can legitimately disappear
 * after someone connected — and in the preview, this is what shows the owner
 * the gaps in their own profile.
 */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 font-display text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className={value ? "min-w-0 font-medium wrap-break-word" : "text-ink/45"}>
        {value || "Not provided"}
      </dd>
    </div>
  );
}

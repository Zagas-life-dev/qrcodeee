import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import { siteUrl } from "@/lib/site";
import {
  ActionLink,
  Columns,
  Notice,
  Page,
  PageHeader,
  Section,
  actionClass,
} from "@/components/page";

import { AvatarUpload } from "./avatar-upload";
import { CustomFields } from "./custom-fields";
import { DeleteAccount } from "./delete-account";
import { HandleForm } from "./handle-form";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile · Skan QR" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/profile");

  // Both reads go through RLS as the caller — the profiles row via the "publicly
  // readable" policy and contact_details via the owner policy (§4).
  const [{ data: profile, error: profileError }, { data: contact }, { data: customFields }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("name, bio, photo_url, handle, deleted_at")
        .eq("id", user.id)
        .single(),
      supabase
        .from("contact_details")
        .select("phone, email")
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("custom_fields")
        .select("id, label, value, is_public")
        .eq("profile_id", user.id)
        .order("sort_order", { ascending: true }),
    ]);

  if (profileError || !profile) {
    // The signup trigger creates this row, so its absence means the migrations
    // haven't been applied or handle_new_user() failed — worth saying plainly
    // rather than rendering an empty form that silently can't save.
    return (
      <Page>
        <Notice tone="error">
          We couldn&apos;t load your profile. If this is a fresh environment,
          check that the migrations in{" "}
          <code className="font-mono">supabase/migrations</code> have been
          applied.
        </Notice>
      </Page>
    );
  }

  return (
    <Page width="wide">
      {/* Sign out moved out of the header and into Account, below. It sat
          beside Preview as an equal, which put the one irreversible-feeling
          control on the page in the top-right corner where a thumb lands
          reaching for the notification bell. */}
      <PageHeader
        title="Your profile"
        description={user.email}
        actions={
          <ActionLink href="/preview" tone="info">
            Preview
          </ActionLink>
        }
      />

      {/* The forms are the work and stay in one readable column; what goes in
          the rail is the two things you look UP rather than fill in — where this
          profile is published, and the account it belongs to. */}
      <Columns
        aside={
          <>
            <div className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
              <h2 className="font-display text-base">Your public page</h2>
              <p className="mt-2 text-sm font-medium">
                Everything above appears on your link. What sits underneath it is
                yours to build.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionLink href="/site" tone="primary" size="sm">
                  Edit your page
                </ActionLink>
                {/* A real external navigation, not a router push: this is the
                    stranger's view and it should open beside the editor. */}
                <a
                  href={`/u/${profile.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className={actionClass({ size: "sm" })}
                >
                  View ↗
                </a>
              </div>
            </div>

            <div className="rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
              <h2 className="font-display text-base">Account</h2>
              <p className="mt-2 text-sm font-medium">{user.email}</p>
              <form action={signOut} className="mt-3">
                <button type="submit" className={actionClass({ block: true, size: "sm" })}>
                  Sign out
                </button>
              </form>
            </div>
          </>
        }
      >
        <AvatarUpload photoUrl={profile.photo_url} name={profile.name} />

        <ProfileForm
          name={profile.name}
          bio={profile.bio}
          phone={contact?.phone ?? null}
          email={contact?.email ?? null}
        />

        <HandleForm handle={profile.handle} origin={siteUrl()} />

        <CustomFields fields={customFields ?? []} />

        {/* Deletion stays at the END OF THE MAIN COLUMN rather than moving to
            the rail with sign-out. The rail is sticky — it is on screen the
            whole time you are editing — and the one irreversible control in the
            app should be somewhere you arrive at, not somewhere you live. */}
        <Section title="Danger zone">
          <DeleteAccount />
        </Section>
      </Columns>
    </Page>
  );
}

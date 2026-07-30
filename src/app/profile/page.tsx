import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import {
  ActionLink,
  Notice,
  Page,
  PageHeader,
  Section,
  actionClass,
} from "@/components/page";

import { AvatarUpload } from "./avatar-upload";
import { CustomFields } from "./custom-fields";
import { DeleteAccount } from "./delete-account";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile · QR Connect" };

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
        .select("name, bio, photo_url, deleted_at")
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
    <Page>
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

      <AvatarUpload photoUrl={profile.photo_url} name={profile.name} />

      <ProfileForm
        name={profile.name}
        bio={profile.bio}
        phone={contact?.phone ?? null}
        email={contact?.email ?? null}
      />

      <CustomFields fields={customFields ?? []} />

      <Section title="Account">
        <div className="space-y-4">
          <form action={signOut}>
            <button type="submit" className={actionClass({ block: true })}>
              Sign out
            </button>
          </form>
          <DeleteAccount />
        </div>
      </Section>
    </Page>
  );
}

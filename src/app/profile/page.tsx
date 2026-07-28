import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";

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
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <p className="max-w-sm text-sm opacity-70">
          We couldn&apos;t load your profile. If this is a fresh environment,
          check that the migrations in <code>supabase/migrations</code> have been
          applied.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
          <p className="mt-1 text-sm opacity-70">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/preview"
            className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5"
          >
            Preview
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm opacity-70 transition hover:bg-current/5 hover:opacity-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AvatarUpload photoUrl={profile.photo_url} name={profile.name} />

      <ProfileForm
        name={profile.name}
        bio={profile.bio}
        phone={contact?.phone ?? null}
        email={contact?.email ?? null}
      />

      <CustomFields fields={customFields ?? []} />

      <DeleteAccount />
    </main>
  );
}

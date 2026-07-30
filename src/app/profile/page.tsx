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
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <p className="max-w-sm rounded-brutal border-2 border-ink bg-coral p-4 text-sm font-medium shadow-brutal">
          We couldn&apos;t load your profile. If this is a fresh environment,
          check that the migrations in{" "}
          <code className="font-mono font-bold">supabase/migrations</code> have
          been applied.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl leading-none tracking-tight">
            Your profile
          </h1>
          <p className="mt-2 text-sm font-medium wrap-break-word">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/preview"
            className="flex min-h-11 items-center rounded-brutal border-2 border-ink bg-sky px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
          >
            Preview
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="min-h-11 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm"
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

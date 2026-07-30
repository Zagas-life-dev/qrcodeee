import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { Scanner } from "./scanner";

export const metadata = { title: "Scan · QR Connect" };

export default async function ScanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scan");

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl leading-none tracking-tight">Scan a code</h1>
      <p className="mt-3 text-sm font-medium">
        Scanning connects you both at once. There&apos;s no request to accept.
      </p>
      <Scanner />
    </main>
  );
}

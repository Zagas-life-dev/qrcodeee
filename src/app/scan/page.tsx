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
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Scan a code</h1>
      <p className="mt-1 text-sm opacity-70">
        Scanning connects you both at once. There&apos;s no request to accept.
      </p>
      <Scanner />
    </main>
  );
}

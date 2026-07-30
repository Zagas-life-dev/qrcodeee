import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Page, PageHeader } from "@/components/page";

import { Scanner } from "./scanner";

export const metadata = { title: "Scan · QR Connect" };

export default async function ScanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scan");

  return (
    <Page width="md">
      <PageHeader
        title="Scan a code"
        description="Scanning connects you both at once. There's no request to accept."
      />
      <Scanner />
    </Page>
  );
}

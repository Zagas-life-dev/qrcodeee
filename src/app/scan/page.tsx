import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { scanExplanation } from "@/lib/contacts/scan-explain";
import { Notice, Page, PageHeader } from "@/components/page";

import { Scanner } from "./scanner";

export const metadata = { title: "Scan · Skan QR" };

export default async function ScanPage({
  searchParams,
}: {
  /**
   * `?e=` explains a scan that didn't connect. It lands here rather than on the
   * scanned person's page in the one case where there is no page to land on:
   * a token that resolved to nobody, arriving on a pre-change `/connect/{token}`
   * URL that carries no handle. Display-only — see lib/contacts/scan-explain.ts.
   */
  searchParams: Promise<{ e?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scan");

  const explain = scanExplanation((await searchParams).e);

  return (
    <Page width="md">
      <PageHeader
        title="Scan a code"
        description="Scanning connects you both at once. There's no request to accept."
      />

      {/* Above the camera, not below it: the reason someone is back here is
          that the last scan failed, and the answer belongs where they are
          already looking. */}
      {explain ? (
        <Notice tone="warn" role="status" className="mt-6">
          {explain}
        </Notice>
      ) : null}

      <Scanner />
    </Page>
  );
}

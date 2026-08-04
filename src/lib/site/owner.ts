import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import type { Json } from "@/lib/supabase/database.types";

import type { SiteBlock, SiteSection } from "./read";

export type OwnerSection = SiteSection & { blocks: SiteBlock[] };

export type OwnerSite = {
  published: boolean;
  theme: Json;
  sections: OwnerSection[];
};

/**
 * The caller's own site, with everything on it.
 *
 * Deliberately NOT `getPublicSite`, and not just because of the extra columns.
 * That function is `use cache` and reads as `anon`, so it would show the owner
 * their own page as a stranger sees it: unpublished sites invisible, `private`
 * drafts missing, and — worst for an editor — a cached snapshot that lags their
 * last edit. This one is uncached and cookie-bound, so RLS's owner policies
 * return every section and block including drafts, always current.
 */
export async function getOwnSite(): Promise<OwnerSite | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data: site } = await supabase
    .from("sites")
    .select("published, theme")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!site) return null;

  const { data: sections } = await supabase
    .from("site_sections")
    .select("id, layout_type, root_cell, sort_order, pinned")
    .eq("site_id", user.id)
    .order("sort_order", { ascending: true });

  if (!sections || sections.length === 0) {
    return { published: site.published, theme: site.theme, sections: [] };
  }

  const { data: blocks } = await supabase
    .from("site_blocks")
    .select("id, section_id, type, content, style, sort_order, visibility")
    .in(
      "section_id",
      sections.map((s) => s.id),
    )
    .order("sort_order", { ascending: true });

  return {
    published: site.published,
    theme: site.theme,
    sections: sections.map((section) => ({
      ...section,
      blocks: (blocks ?? []).filter((block) => block.section_id === section.id),
    })),
  };
}

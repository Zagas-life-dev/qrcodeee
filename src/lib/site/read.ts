import { cacheLife, cacheTag } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import type {
  BlockVisibility,
  Json,
  SectionLayout,
} from "@/lib/supabase/database.types";

/**
 * Whose page this is.
 *
 * `id` is what image blocks rebuild their Cloudinary path from (see media.ts);
 * the rest is what the `identity` block draws. Passed as one object rather than
 * five props because it is one thing, and prop-drilled rather than held in a
 * context because these components render on the server for /u/{handle} AND in
 * the client editor — a React context cannot span both.
 */
export type SiteOwner = {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  handle: string;
};

export type SiteBlock = {
  id: string;
  section_id: string;
  type: string;
  content: Json;
  /** Alignment, tone and text scale. Parsed by parseBlockStyle, never null. */
  style: Json;
  sort_order: number;
  visibility: BlockVisibility;
};

export type SiteSection = {
  id: string;
  layout_type: SectionLayout;
  root_cell: Json | null;
  sort_order: number;
};

export type PublicSite = {
  theme: Json;
  sections: SiteSection[];
  /** PUBLIC blocks only — see the note on the split below. */
  blocks: SiteBlock[];
};

/**
 * The published site, as anyone sees it (site-spec S8).
 *
 * CACHED, WHICH DICTATES WHAT MAY BE IN IT. Read through `createPublicClient()`
 * — the `anon` role, no cookies — so the result is identical for every visitor
 * and safe to share. Connections-only blocks are therefore NOT here; they come
 * from `getGatedBlocks` per viewer, and the renderer merges the two.
 *
 * Publication is enforced by RLS rather than by a filter: the anon policy on
 * `sites` only exposes rows with `published = true`, so an unpublished site
 * returns null here and the profile page falls back to the contact card alone.
 * Writing `.eq("published", true)` as well would be a second copy of the rule.
 */
export async function getPublicSite(profileId: string): Promise<PublicSite | null> {
  "use cache";
  cacheTag(`site:${profileId}`);
  cacheLife("hours");

  const supabase = createPublicClient();

  const { data: site } = await supabase
    .from("sites")
    .select("theme")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!site) return null;

  const { data: sections } = await supabase
    .from("site_sections")
    .select("id, layout_type, root_cell, sort_order")
    .eq("site_id", profileId)
    .order("sort_order", { ascending: true });

  if (!sections || sections.length === 0) {
    return { theme: site.theme, sections: [], blocks: [] };
  }

  const { data: blocks } = await supabase
    .from("site_blocks")
    .select("id, section_id, type, content, style, sort_order, visibility")
    .in(
      "section_id",
      sections.map((s) => s.id),
    )
    .order("sort_order", { ascending: true });

  return { theme: site.theme, sections, blocks: blocks ?? [] };
}

/**
 * The blocks this particular viewer is additionally allowed to see.
 *
 * Never cached, and never merged into `getPublicSite` — the whole point of the
 * split is that one half is viewer-independent. RLS does the authorisation: the
 * connections-gated policy on `site_blocks` returns these rows only to an active
 * connection, so a stranger gets an empty array without this code branching on
 * anything.
 *
 * Returns [] rather than throwing on error. A failure here withholds content
 * that was already conditional; failing the whole page over it would turn a
 * degraded profile into no profile.
 */
export async function getGatedBlocks(profileId: string): Promise<SiteBlock[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("site_blocks")
    .select("id, section_id, type, content, style, sort_order, visibility, site_sections!inner(site_id)")
    .eq("site_sections.site_id", profileId)
    .eq("visibility", "connections")
    .order("sort_order", { ascending: true });

  if (!data) return [];

  // The join column is only there to scope the query; drop it so the shape
  // matches SiteBlock exactly and the renderer can treat both sources alike.
  return data.map(({ id, section_id, type, content, style, sort_order, visibility }) => ({
    id,
    section_id,
    type,
    content,
    style,
    sort_order,
    visibility,
  }));
}

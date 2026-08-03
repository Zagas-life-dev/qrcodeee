"use server";

import { revalidatePath, updateTag } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import type {
  BlockVisibility,
  SectionLayout,
} from "@/lib/supabase/database.types";

import {
  MAX_CELL_LEAVES,
  insertBlock,
  isUuid,
  parseCell,
  removeBlock,
  setRatioAt,
  splitAtBlock,
  validateCellTree,
  type Cell,
  type CellPath,
} from "./cell";
import { STARTER_CONTENT, isBlockType } from "./blocks";
import {
  isSiteDensity,
  isSiteFont,
  isSiteRadius,
  isSiteSkin,
  parseAccent,
} from "./theme";
import { clampBlockScale, isBlockAlign, isBlockTone } from "./block-style";

export type SiteActionResult = { ok: true } | { ok: false; message: string };

const OK: SiteActionResult = { ok: true };
const SIGNED_OUT: SiteActionResult = {
  ok: false,
  message: "Your session expired. Sign in again.",
};
const BAD_ID: SiteActionResult = {
  ok: false,
  message: "Couldn't save that — reload the page and try again.",
};

/**
 * Site mutations (site-spec S4/S5).
 *
 * OWNERSHIP IS NOT CHECKED IN THIS FILE, ANYWHERE, AND THAT IS DELIBERATE. Every
 * statement below runs through the cookie-bound client, and the owner policies on
 * `sites`, `site_sections` and `site_blocks` scope each one to `auth.uid()`.
 * Adding an `if (section.site_id !== user.id)` here would create a second place
 * where authorisation is decided — one that can drift from the policy and that a
 * direct PostgREST call bypasses anyway. The `auth.uid()` reads that DO appear
 * are for writing rows and busting caches, never for permission.
 *
 * Every path that changes what a visitor would see ends in `updateTag` on this
 * profile's site tag. That is the same tag `getPublicSite` sets, so a save is
 * visible on /u/{handle} on the next request rather than up to an hour later.
 *
 * IDS FOR NEW ROWS COME FROM THE CLIENT, and that is a change worth defending.
 * The editor is optimistic (see mutations.ts): it draws a new section or block
 * the instant it is asked for, which is impossible if the id only exists after
 * the insert returns. So the browser mints a uuid and sends it.
 *
 * It grants nothing. `site_id`/`section_id` still come from `auth.uid()` and the
 * owner policies, so a chosen id can only ever name a row inside the caller's
 * own site; the primary key rejects a collision; and a malformed value is caught
 * by `isUuid` before it reaches Postgres. What it buys is that a queued edit
 * REFERRING to the new row — style it, fill it, delete it — is meaningful the
 * moment it is made, including while offline, rather than having to wait for an
 * id the client would otherwise have to be told.
 *
 * It also makes the two inserts RETRY-SAFE, which a queue that resends after a
 * dropped connection needs and a server-generated id cannot give. A request that
 * reached Postgres but whose response was lost is indistinguishable from one that
 * never arrived, so the queue must resend — and with a caller-chosen primary key
 * the resend collides (23505) instead of creating a second section. Both inserts
 * below therefore treat 23505 as success: the row the caller asked for exists,
 * which is all the caller was asking for.
 */
async function bust(profileId: string) {
  updateTag(`site:${profileId}`);
  revalidatePath("/site");
}

/**
 * Load a bento section's tree alongside the ids it is allowed to reference.
 *
 * Returns `tree: null` for a non-bento section, which every caller treats as
 * "no tree to maintain" rather than as an error — switching a section to
 * `single` and back must not lose the blocks.
 */
async function loadSection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectionId: string,
) {
  const { data: section } = await supabase
    .from("site_sections")
    .select("id, layout_type, root_cell")
    .eq("id", sectionId)
    .maybeSingle();

  if (!section) return null;

  const { data: blocks } = await supabase
    .from("site_blocks")
    .select("id")
    .eq("section_id", sectionId);

  return {
    layout: section.layout_type,
    tree: section.root_cell ? parseCell(section.root_cell) : null,
    blockIds: (blocks ?? []).map((b) => b.id),
  };
}

/**
 * Persist a tree, refusing to write one that fails validation.
 *
 * The check is here rather than only in the pure helpers because this is the
 * last point before the value becomes durable. A tree whose leaves disagree with
 * the section's blocks renders as a hole or hides a block from its own owner —
 * cheap to reject now, awkward to detect later.
 */
async function saveTree(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectionId: string,
  tree: Cell | null,
  blockIds: string[],
): Promise<SiteActionResult> {
  if (tree) {
    const problem = validateCellTree(tree, blockIds);
    if (problem) return { ok: false, message: problem };
  }

  const { error } = await supabase
    .from("site_sections")
    .update({ root_cell: tree })
    .eq("id", sectionId);

  return error ? { ok: false, message: "Couldn't save the layout." } : OK;
}

// ── Sections ───────────────────────────────────────────────────────────────

export async function addSection(
  layout: SectionLayout,
  sectionId: string,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (!isUuid(sectionId)) return BAD_ID;

  const supabase = await createClient();

  const { data: last } = await supabase
    .from("site_sections")
    .select("sort_order")
    .eq("site_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("site_sections").insert({
    id: sectionId,
    site_id: user.id,
    layout_type: layout,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  // 23505 is this exact row already existing, which is a retry landing twice
  // rather than a failure — see the file header. Anything else is a real error.
  if (error && error.code !== "23505") {
    return {
      ok: false,
      // 53400 is the hard section cap from the schema, not a tier limit.
      message:
        error.code === "53400"
          ? "You've reached the maximum number of sections."
          : "Couldn't add that section.",
    };
  }

  await bust(user.id);
  return OK;
}

export async function deleteSection(sectionId: string): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  // Blocks cascade from the section, so the tree goes with them.
  const { error } = await supabase.from("site_sections").delete().eq("id", sectionId);
  if (error) return { ok: false, message: "Couldn't delete that section." };

  await bust(user.id);
  return OK;
}

/**
 * Move a section one place up or down.
 *
 * Buttons rather than drag: reordering a handful of full-width sections is the
 * one place where two taps beat a gesture on a phone, and it needs no pointer
 * handling, no touch fallback and no scroll-while-dragging.
 *
 * Swaps the two sort_order values rather than renumbering the list, so a
 * concurrent edit elsewhere in the page can't be clobbered by a full rewrite.
 *
 * `fromIndex` IS WHAT MAKES A RELATIVE MOVE SAFE TO SEND TWICE. It is the only
 * mutation in this file that is neither an absolute write nor naturally
 * idempotent, so a resend after a lost response — which the offline queue must
 * do, having no way to tell a dropped reply from a dropped request — would move
 * the section a second place. Checking that the section is still where the
 * caller thought turns the duplicate into a no-op. It doubles as the
 * lost-update guard for a second tab: a move computed against a stale order is
 * refused rather than applied to an order it was not describing.
 */
export async function moveSection(
  sectionId: string,
  direction: "up" | "down",
  fromIndex: number,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();

  const { data: sections } = await supabase
    .from("site_sections")
    .select("id, sort_order")
    .eq("site_id", user.id)
    .order("sort_order", { ascending: true });

  if (!sections) return { ok: false, message: "Couldn't reorder your sections." };

  const index = sections.findIndex((s) => s.id === sectionId);
  if (index !== fromIndex) return OK;

  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= sections.length) return OK;

  const a = sections[index];
  const b = sections[target];

  await supabase.from("site_sections").update({ sort_order: b.sort_order }).eq("id", a.id);
  await supabase.from("site_sections").update({ sort_order: a.sort_order }).eq("id", b.id);

  await bust(user.id);
  return OK;
}

export async function setSectionLayout(
  sectionId: string,
  layout: SectionLayout,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  const section = await loadSection(supabase, sectionId);
  if (!section) return { ok: false, message: "That section no longer exists." };

  // Switching TO bento needs a tree; the other layouts ignore one. An existing
  // tree is left untouched when switching away, so a round trip through
  // `single` and back preserves the arrangement rather than flattening it.
  let tree = section.tree;
  if (layout === "bento" && !tree) {
    // A bento tree holds at most MAX_CELL_LEAVES blocks, while the other layouts
    // are bounded only by the section cap. Refusing up front is the difference
    // between an explanation and a section that silently loses blocks: a partial
    // tree would leave the surplus referenced by nothing, invisible on the page
    // AND unreachable in the editor.
    if (section.blockIds.length > MAX_CELL_LEAVES) {
      return {
        ok: false,
        message: `Bento sections hold up to ${MAX_CELL_LEAVES} blocks. Move some into another section first.`,
      };
    }

    for (const id of section.blockIds) {
      const result = insertBlock(tree, id);
      if (!result.ok) {
        return { ok: false, message: "Couldn't arrange those blocks into a bento." };
      }
      tree = result.root;
    }
  }

  const { error } = await supabase
    .from("site_sections")
    .update({ layout_type: layout, root_cell: tree })
    .eq("id", sectionId);

  if (error) return { ok: false, message: "Couldn't change that layout." };

  await bust(user.id);
  return OK;
}

// ── Blocks ─────────────────────────────────────────────────────────────────

/**
 * Add a block, either appended to the section or splitting an existing cell.
 *
 * One action for both because they differ only in where the new id lands in the
 * tree, and splitting them would duplicate the insert, the cap handling and the
 * cache bust three times over.
 */
export async function addBlock(
  sectionId: string,
  type: string,
  blockId: string,
  splitFrom?: { blockId: string; direction: "row" | "col" },
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;
  if (!isUuid(blockId)) return BAD_ID;
  // Narrowing, not just validating: `type` arrives as a string from the client
  // and this is what makes it a BlockType for the lookup below.
  if (!isBlockType(type)) return { ok: false, message: "Unknown block type." };

  const supabase = await createClient();
  const section = await loadSection(supabase, sectionId);
  if (!section) return { ok: false, message: "That section no longer exists." };

  // Already placed by an earlier delivery of this same request. Returning here
  // rather than falling through matters: the tree work below is written for a
  // block that is NOT yet a leaf, and re-running it would either fail as a
  // duplicate leaf or split the block away from itself.
  if (section.blockIds.includes(blockId)) {
    await bust(user.id);
    return OK;
  }

  const { error } = await supabase.from("site_blocks").insert({
    id: blockId,
    section_id: sectionId,
    type,
    content: STARTER_CONTENT[type] as never,
    sort_order: section.blockIds.length,
  });

  if (error) {
    return {
      ok: false,
      message:
        error.code === "53400"
          ? "You've reached the maximum number of blocks."
          : "Couldn't add that block.",
    };
  }

  if (section.layout !== "bento") {
    await bust(user.id);
    return OK;
  }

  // `splitFrom` needs an existing tree to split INSIDE. With no tree there is no
  // cell to divide, so this falls back to a plain append rather than
  // manufacturing one — a synthesised root would be searched for a blockId it
  // could not contain, and the split would fail with a confusing "not found".
  const result =
    splitFrom && section.tree
      ? splitAtBlock(section.tree, splitFrom.blockId, splitFrom.direction, blockId)
      : insertBlock(section.tree, blockId);

  if (!result.ok) {
    // The row exists but has nowhere to live, so take it back out rather than
    // leaving a block the layout can never show and the editor can never reach.
    await supabase.from("site_blocks").delete().eq("id", blockId);
    return {
      ok: false,
      message:
        result.reason === "too_deep"
          ? "This section's layout is as deeply divided as it goes. Add a new section instead."
          : "Couldn't place that block.",
    };
  }

  const saved = await saveTree(supabase, sectionId, result.root, [
    ...section.blockIds,
    blockId,
  ]);
  if (!saved.ok) {
    await supabase.from("site_blocks").delete().eq("id", blockId);
    return saved;
  }

  await bust(user.id);
  return OK;
}

export async function deleteBlock(blockId: string): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();

  const { data: block } = await supabase
    .from("site_blocks")
    .select("section_id")
    .eq("id", blockId)
    .maybeSingle();

  if (!block) return OK;

  const section = await loadSection(supabase, block.section_id);

  const { error } = await supabase.from("site_blocks").delete().eq("id", blockId);
  if (error) return { ok: false, message: "Couldn't delete that block." };

  // Tree first would leave a window where the layout references a live block it
  // no longer holds; deleting the row first means the worst case is a dangling
  // id, which the renderer already prunes.
  if (section?.tree) {
    const tree = removeBlock(section.tree, blockId);
    await saveTree(
      supabase,
      block.section_id,
      tree,
      section.blockIds.filter((id) => id !== blockId),
    );
  }

  await bust(user.id);
  return OK;
}

export async function setBlockVisibility(
  blockId: string,
  visibility: BlockVisibility,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_blocks")
    .update({ visibility })
    .eq("id", blockId);

  if (error) return { ok: false, message: "Couldn't change who can see that." };

  await bust(user.id);
  return OK;
}

export async function setSplitRatio(
  sectionId: string,
  path: CellPath,
  ratio: number,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  const section = await loadSection(supabase, sectionId);
  if (!section?.tree) return OK;

  const saved = await saveTree(
    supabase,
    sectionId,
    setRatioAt(section.tree, path, ratio),
    section.blockIds,
  );
  if (!saved.ok) return saved;

  await bust(user.id);
  return OK;
}

/** Content is per-type, so the payload is parsed by the caller's own form. */
export async function saveBlockContent(
  blockId: string,
  content: unknown,
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_blocks")
    .update({ content: content as never })
    .eq("id", blockId);

  if (error) {
    return {
      ok: false,
      message:
        error.code === "23514"
          ? "That's too long to save. Try shortening it."
          : "Couldn't save that block.",
    };
  }

  await bust(user.id);
  return OK;
}

// ── Publication ────────────────────────────────────────────────────────────

export async function setPublished(published: boolean): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({ published })
    .eq("profile_id", user.id);

  if (error) return { ok: false, message: "Couldn't change that." };

  await bust(user.id);
  return OK;
}

// ── Appearance ─────────────────────────────────────────────────────────────

/**
 * Set the page's skin and font (site-spec S7).
 *
 * The write is `{skin, font}` and never a spread of what the client sent. That
 * is what stops `theme` becoming an arbitrary JSON bag on a column the renderer
 * reads: an unknown key cannot be stored, so it can never be read back and
 * turned into a style. `parseTheme` on the read side is the second half of the
 * same rule, and both are needed — this one governs what we write, that one
 * governs what a row written some other way means.
 */
export async function setTheme(theme: {
  skin: string;
  font: string;
  accent: string | null;
  radius: string;
  density: string;
}): Promise<SiteActionResult> {
  const { skin, font, accent, radius, density } = theme;
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  if (!isSiteSkin(skin) || !isSiteFont(font) || !isSiteRadius(radius) || !isSiteDensity(density)) {
    return { ok: false, message: "That look isn't one of the options." };
  }

  // `parseAccent` returns null for anything that is not `#rrggbb`, so an
  // unparseable colour silently means "use the skin's" rather than failing the
  // save — the skin and font in the same request are still worth keeping.
  const parsed = accent === null ? null : parseAccent(accent);

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({ theme: { skin, font, accent: parsed, radius, density } })
    .eq("profile_id", user.id);

  if (error) return { ok: false, message: "Couldn't change the look." };

  await bust(user.id);
  return OK;
}

/**
 * Set one block's alignment, tone and text scale (site-spec S7).
 *
 * Written field by field from validated values, never as a spread of what the
 * client sent — same rule as `setTheme`. An unknown key cannot be stored, so it
 * can never be read back and turned into a style.
 */
export async function setBlockStyle(
  blockId: string,
  style: { align: string; tone: string; scale: number; accent: string | null },
): Promise<SiteActionResult> {
  const user = await getSessionUser();
  if (!user) return SIGNED_OUT;

  if (!isBlockAlign(style.align) || !isBlockTone(style.tone)) {
    return { ok: false, message: "That isn't one of the options." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_blocks")
    .update({
      style: {
        align: style.align,
        tone: style.tone,
        scale: clampBlockScale(style.scale),
        accent: style.accent === null ? null : parseAccent(style.accent),
      },
    })
    .eq("id", blockId);

  if (error) return { ok: false, message: "Couldn't change that block." };

  await bust(user.id);
  return OK;
}

/*
 * `newestSectionId` used to live here: the onboarding stepper added a section
 * and then a block into it across two steps, and asked for "the newest one"
 * because it had no id to carry. Client-minted ids made the question
 * unnecessary — the stepper now knows the id before the section exists — and a
 * "most recently created" lookup was always a guess that a second tab could
 * answer wrongly.
 */

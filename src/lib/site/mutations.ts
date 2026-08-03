/**
 * Every site edit, expressed as a value (site-spec S4).
 *
 * WHY THE EDITS BECAME DATA. The editor used to call a server action and wait:
 * one tap, one round trip, every control disabled until it came back. That is
 * fine on a desk and wrong on the phone this product is actually used on, where
 * the same tap costs a second on a good connection and never completes on a bad
 * one — and the whole page sat frozen either way.
 *
 * Turning each edit into a plain object buys three things that a direct call
 * cannot:
 *
 * 1. **It can be applied locally.** `applyMutation` is the same transformation
 *    the server performs, so the editor can show the result immediately and be
 *    right rather than optimistic-and-hoping.
 * 2. **It can be queued.** A value survives a failed request; a function call in
 *    flight does not. This is what makes "keep editing on the underground and
 *    sync when you surface" a queue rather than a rewrite.
 * 3. **It can be stored.** Every field below is JSON, so the queue persists to
 *    localStorage and outlives a reload, a crash, or a closed tab.
 *
 * THE ONE INVARIANT THIS FILE MUST HOLD IS IDEMPOTENCE. A mutation is applied
 * locally the moment it is made, and it stays applied on top of each server
 * snapshot until that snapshot is known to contain it — which means it is
 * routinely applied to state that ALREADY has it. Every case below therefore
 * either sets an absolute value or checks first. `moveSection` is the one that
 * needs real care and carries `fromIndex` for exactly this reason.
 *
 * NOT A SECURITY BOUNDARY. Nothing here decides what is allowed; RLS and the
 * server actions do that, unchanged. The checks that do appear reproduce limits
 * the user would otherwise only discover after a round trip — which, offline, is
 * "after the aeroplane lands".
 */

import type {
  BlockVisibility,
  Json,
  SectionLayout,
} from "@/lib/supabase/database.types";

import { DEFAULT_BLOCK_STYLE, type BlockStyle } from "./block-style";
import { STARTER_CONTENT, type BlockType } from "./blocks";
import {
  MAX_CELL_LEAVES,
  insertBlock,
  parseCell,
  removeBlock,
  setRatioAt,
  splitAtBlock,
  type Cell,
  type CellPath,
} from "./cell";
import type { OwnerSection, OwnerSite } from "./owner";
import type { SiteBlock } from "./read";
import type { SiteTheme } from "./theme";

export type SplitFrom = { blockId: string; direction: "row" | "col" };

export type SiteMutation =
  | { kind: "setPublished"; published: boolean }
  | { kind: "setTheme"; theme: SiteTheme }
  | { kind: "addSection"; sectionId: string; layout: SectionLayout }
  | { kind: "deleteSection"; sectionId: string }
  /**
   * `fromIndex` is what makes a relative move idempotent — see the file header.
   * Without it, re-applying a queued "move down" onto a snapshot that already
   * moved the section would move it a second time.
   */
  | { kind: "moveSection"; sectionId: string; direction: "up" | "down"; fromIndex: number }
  | { kind: "setSectionLayout"; sectionId: string; layout: SectionLayout }
  | {
      kind: "addBlock";
      sectionId: string;
      blockId: string;
      type: BlockType;
      splitFrom?: SplitFrom;
    }
  | { kind: "deleteBlock"; blockId: string }
  | { kind: "setBlockVisibility"; blockId: string; visibility: BlockVisibility }
  | { kind: "setBlockStyle"; blockId: string; style: BlockStyle }
  | { kind: "saveBlockContent"; blockId: string; content: unknown }
  | { kind: "setSplitRatio"; sectionId: string; path: CellPath; ratio: number };

export type ApplyResult =
  | { ok: true; site: OwnerSite }
  | { ok: false; message: string };

const MUTATION_KINDS = new Set<string>([
  "setPublished",
  "setTheme",
  "addSection",
  "deleteSection",
  "moveSection",
  "setSectionLayout",
  "addBlock",
  "deleteBlock",
  "setBlockVisibility",
  "setBlockStyle",
  "saveBlockContent",
  "setSplitRatio",
] satisfies SiteMutation["kind"][]);

/**
 * Is this a mutation this build understands?
 *
 * The gate on the persisted queue, and the reason it is a gate rather than a
 * cast: a queue written by one deploy can be read back by the next, so a tab
 * that went offline before a release can hand this build a `kind` it has never
 * heard of. `applyMutation`'s switch is exhaustive over the union and therefore
 * has no default — an unrecognised kind would fall out of it as `undefined` and
 * take the editor down on the first render after a reload. Checked here, it is
 * one dropped edit instead.
 *
 * Deliberately shallow. The fields are checked by the server action that
 * receives them, which has to check them anyway; duplicating that here would be
 * a second copy of every validation rule with no additional authority.
 */
export function isSiteMutation(value: unknown): value is SiteMutation {
  if (typeof value !== "object" || value === null) return false;
  return MUTATION_KINDS.has((value as { kind?: unknown }).kind as string);
}

/**
 * A fresh id for a row that does not exist yet.
 *
 * `crypto.randomUUID` is unavailable outside a secure context, which in practice
 * means a phone testing against a laptop over plain http on the LAN — a setup
 * common enough that falling back beats crashing the editor. The fallback is
 * still `getRandomValues`, so it is a real v4 uuid and not a weaker id.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

// ── Plumbing ───────────────────────────────────────────────────────────────

const ok = (site: OwnerSite): ApplyResult => ({ ok: true, site });

/** `Cell` is JSON by construction; this is where that fact is asserted once. */
const asJson = (cell: Cell | null): Json => cell as unknown as Json;

function findSection(site: OwnerSite, sectionId: string): OwnerSection | undefined {
  return site.sections.find((section) => section.id === sectionId);
}

function sectionOf(site: OwnerSite, blockId: string): OwnerSection | undefined {
  return site.sections.find((section) =>
    section.blocks.some((block) => block.id === blockId),
  );
}

function replaceSection(site: OwnerSite, next: OwnerSection): OwnerSite {
  return {
    ...site,
    sections: site.sections.map((section) => (section.id === next.id ? next : section)),
  };
}

/** Absolute by construction, so applying it twice is applying it once. */
function patchBlock(
  site: OwnerSite,
  blockId: string,
  patch: (block: SiteBlock) => SiteBlock,
): OwnerSite {
  return {
    ...site,
    sections: site.sections.map((section) =>
      section.blocks.some((block) => block.id === blockId)
        ? {
            ...section,
            blocks: section.blocks.map((block) =>
              block.id === blockId ? patch(block) : block,
            ),
          }
        : section,
    ),
  };
}

/**
 * Fold a section's blocks into a bento tree, exactly as `setSectionLayout` does
 * on the server. Shared by the two callers that can bring a tree into existence.
 */
function seedTree(blockIds: string[]): { ok: true; tree: Cell | null } | { ok: false; message: string } {
  if (blockIds.length > MAX_CELL_LEAVES) {
    return {
      ok: false,
      message: `Bento sections hold up to ${MAX_CELL_LEAVES} blocks. Move some into another section first.`,
    };
  }

  let tree: Cell | null = null;
  for (const id of blockIds) {
    const result = insertBlock(tree, id);
    if (!result.ok) {
      return { ok: false, message: "Couldn't arrange those blocks into a bento." };
    }
    tree = result.root;
  }

  return { ok: true, tree };
}

// ── The reducer ────────────────────────────────────────────────────────────

/**
 * Apply one edit to a site, or explain why it can't be.
 *
 * Returning a reason rather than throwing is what lets the editor refuse a
 * doomed edit UP FRONT — the caps below are the ones the server also enforces,
 * and finding out about them locally is the difference between "that won't fit"
 * as you tap and a rejection that arrives ten minutes later when the connection
 * comes back.
 *
 * A mutation whose target has vanished is `ok` and a no-op, never an error. That
 * is the case where a queued edit lands on a snapshot in which the row was
 * deleted elsewhere, and re-materialising it would be worse than dropping it.
 */
export function applyMutation(site: OwnerSite, mutation: SiteMutation): ApplyResult {
  switch (mutation.kind) {
    case "setPublished":
      return ok({ ...site, published: mutation.published });

    case "setTheme":
      return ok({ ...site, theme: mutation.theme as unknown as Json });

    case "addSection": {
      // Already here: this is the re-apply path, not a duplicate request.
      if (findSection(site, mutation.sectionId)) return ok(site);

      const last = site.sections[site.sections.length - 1];
      return ok({
        ...site,
        sections: [
          ...site.sections,
          {
            id: mutation.sectionId,
            layout_type: mutation.layout,
            root_cell: null,
            sort_order: (last?.sort_order ?? -1) + 1,
            blocks: [],
          },
        ],
      });
    }

    case "deleteSection":
      return ok({
        ...site,
        sections: site.sections.filter((section) => section.id !== mutation.sectionId),
      });

    case "moveSection": {
      const index = site.sections.findIndex((s) => s.id === mutation.sectionId);
      // Not where it was when the move was made — so either it already moved
      // (re-apply) or something else did. Either way, leave it alone.
      if (index === -1 || index !== mutation.fromIndex) return ok(site);

      const target = mutation.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= site.sections.length) return ok(site);

      const sections = [...site.sections];
      const a = sections[index];
      const b = sections[target];
      // Swap the rows AND their sort_order, mirroring the server: the array
      // position is what renders, the sort_order is what the next edit reads.
      sections[index] = { ...b, sort_order: a.sort_order };
      sections[target] = { ...a, sort_order: b.sort_order };
      return ok({ ...site, sections });
    }

    case "setSectionLayout": {
      const section = findSection(site, mutation.sectionId);
      if (!section) return ok(site);

      // Switching TO bento needs a tree; the others ignore one, and an existing
      // tree survives a round trip through `single` and back.
      let root_cell = section.root_cell;
      if (mutation.layout === "bento" && !parseCell(section.root_cell)) {
        const seeded = seedTree(section.blocks.map((block) => block.id));
        if (!seeded.ok) return seeded;
        root_cell = asJson(seeded.tree);
      }

      return ok(
        replaceSection(site, { ...section, layout_type: mutation.layout, root_cell }),
      );
    }

    case "addBlock": {
      const section = findSection(site, mutation.sectionId);
      if (!section) return ok(site);
      if (sectionOf(site, mutation.blockId)) return ok(site);

      const block: SiteBlock = {
        id: mutation.blockId,
        section_id: section.id,
        type: mutation.type,
        content: STARTER_CONTENT[mutation.type] as Json,
        style: DEFAULT_BLOCK_STYLE as unknown as Json,
        sort_order: section.blocks.length,
        visibility: "public",
      };

      const blocks = [...section.blocks, block];

      if (section.layout_type !== "bento") {
        return ok(replaceSection(site, { ...section, blocks }));
      }

      const tree = parseCell(section.root_cell);
      // `splitFrom` needs a tree to split INSIDE; with none there is no cell to
      // divide, so this falls back to a plain append rather than manufacturing
      // one — same reasoning as the server.
      const result =
        mutation.splitFrom && tree
          ? splitAtBlock(tree, mutation.splitFrom.blockId, mutation.splitFrom.direction, block.id)
          : insertBlock(tree, block.id);

      if (!result.ok) {
        return {
          ok: false,
          message:
            result.reason === "too_deep"
              ? "This section's layout is as deeply divided as it goes. Add a new section instead."
              : "Couldn't place that block.",
        };
      }

      return ok(
        replaceSection(site, { ...section, blocks, root_cell: asJson(result.root) }),
      );
    }

    case "deleteBlock": {
      const section = sectionOf(site, mutation.blockId);
      if (!section) return ok(site);

      const blocks = section.blocks.filter((block) => block.id !== mutation.blockId);
      const tree = parseCell(section.root_cell);

      return ok(
        replaceSection(site, {
          ...section,
          blocks,
          root_cell: tree ? asJson(removeBlock(tree, mutation.blockId)) : section.root_cell,
        }),
      );
    }

    case "setBlockVisibility":
      return ok(
        patchBlock(site, mutation.blockId, (block) => ({
          ...block,
          visibility: mutation.visibility,
        })),
      );

    case "setBlockStyle":
      return ok(
        patchBlock(site, mutation.blockId, (block) => ({
          ...block,
          style: mutation.style as unknown as Json,
        })),
      );

    case "saveBlockContent":
      return ok(
        patchBlock(site, mutation.blockId, (block) => ({
          ...block,
          content: mutation.content as Json,
        })),
      );

    case "setSplitRatio": {
      const section = findSection(site, mutation.sectionId);
      const tree = section ? parseCell(section.root_cell) : null;
      if (!section || !tree) return ok(site);

      return ok(
        replaceSection(site, {
          ...section,
          root_cell: asJson(setRatioAt(tree, mutation.path, mutation.ratio)),
        }),
      );
    }
  }
}

/**
 * What this mutation is the current answer for, or null if it is an event.
 *
 * THE DISTINCTION IS BETWEEN SETTING A VALUE AND DOING A THING. "The accent is
 * #ff0000" replaces "the accent is #ff3300" completely — sending both is sending
 * a value nobody will ever see. "Add a block" replaces nothing; two of them mean
 * two blocks. So the first kind gets a key and the queue keeps only the newest
 * entry per key; the second gets null and every one is kept.
 *
 * This is not a micro-optimisation. A native colour input fires on every frame
 * of a drag, so choosing a colour by dragging produces dozens of writes — one
 * round trip each, in a queue that sends serially, all of them describing
 * colours the user passed through on the way to the one they wanted. Coalescing
 * turns the whole gesture into a single write, and it bounds the queue while
 * offline instead of letting an afternoon of tweaking accumulate.
 *
 * Safe because a keyed mutation is an absolute write to one target: replacing an
 * earlier one cannot change what any mutation between them means, whatever they
 * were.
 */
export function coalesceKey(mutation: SiteMutation): string | null {
  switch (mutation.kind) {
    case "setPublished":
      return "published";
    case "setTheme":
      return "theme";
    case "setSectionLayout":
      return `layout:${mutation.sectionId}`;
    case "setBlockVisibility":
      return `visibility:${mutation.blockId}`;
    case "setBlockStyle":
      return `style:${mutation.blockId}`;
    case "saveBlockContent":
      return `content:${mutation.blockId}`;
    case "setSplitRatio":
      return `ratio:${mutation.sectionId}:${mutation.path.join("")}`;
    // Creations, deletions and moves are events: each one happened, and a
    // second one is a second thing that happened.
    case "addSection":
    case "deleteSection":
    case "moveSection":
    case "addBlock":
    case "deleteBlock":
      return null;
  }
}

/**
 * Fold a whole queue onto a snapshot.
 *
 * A mutation that no longer applies is SKIPPED rather than aborting the fold.
 * The alternative — bailing out — would drop every later edit too, so one stale
 * entry in a queue of eight would silently discard the other seven.
 */
export function applyAll(site: OwnerSite, mutations: readonly SiteMutation[]): OwnerSite {
  return mutations.reduce<OwnerSite>((current, mutation) => {
    const result = applyMutation(current, mutation);
    return result.ok ? result.site : current;
  }, site);
}

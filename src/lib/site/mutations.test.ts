import { describe, expect, it } from "vitest";

import { DEFAULT_BLOCK_STYLE } from "./block-style";
import { cellLeaves, parseCell } from "./cell";
import {
  applyAll,
  applyMutation,
  coalesceKey,
  isSiteMutation,
  newId,
  type SiteMutation,
} from "./mutations";
import type { OwnerSection, OwnerSite } from "./owner";
import type { SiteBlock } from "./read";
import { DEFAULT_THEME } from "./theme";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = id(1);
const S2 = id(2);
const S3 = id(3);
const B1 = id(11);
const B2 = id(12);
const B3 = id(13);

function block(blockId: string, sectionId: string, sort = 0): SiteBlock {
  return {
    id: blockId,
    section_id: sectionId,
    type: "text",
    content: { doc: { v: 1, nodes: [] } },
    style: DEFAULT_BLOCK_STYLE as never,
    sort_order: sort,
    visibility: "public",
  };
}

function section(
  sectionId: string,
  sort: number,
  extra: Partial<OwnerSection> = {},
): OwnerSection {
  return {
    id: sectionId,
    layout_type: "single",
    root_cell: null,
    sort_order: sort,
    pinned: false,
    blocks: [],
    ...extra,
  };
}

/** The permanent identity section: first, and the one nothing may remove. */
function pinnedSection(sectionId: string, blocks: SiteBlock[] = []): OwnerSection {
  return section(sectionId, -1, { pinned: true, blocks });
}

const empty: OwnerSite = { published: false, theme: {}, sections: [] };

/** Unwraps, failing loudly — every call below is expected to be applicable. */
function apply(site: OwnerSite, mutation: SiteMutation): OwnerSite {
  const result = applyMutation(site, mutation);
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
  return result.site;
}

/**
 * THE CENTRAL INVARIANT OF THE OFFLINE QUEUE.
 *
 * A queued mutation is applied to the draft when it is made and stays applied on
 * top of every server snapshot until one is known to contain it — so it is
 * routinely applied to state that already has it. Separately, delivery is
 * at-least-once: a request whose response was lost is resent, so the SERVER can
 * see the same mutation twice too.
 *
 * Both of those are only safe if applying twice equals applying once. This is
 * the property that makes the whole design work, so it is asserted for every
 * mutation kind rather than spot-checked.
 */
function expectIdempotent(site: OwnerSite, mutation: SiteMutation) {
  const once = apply(site, mutation);
  const twice = apply(once, mutation);
  expect(twice).toEqual(once);
}

describe("applyMutation — idempotence", () => {
  const oneSection: OwnerSite = { ...empty, sections: [section(S1, 0)] };
  const withBlock: OwnerSite = {
    ...empty,
    sections: [section(S1, 0, { blocks: [block(B1, S1)] })],
  };
  const three: OwnerSite = {
    ...empty,
    sections: [section(S1, 0), section(S2, 1), section(S3, 2)],
  };

  it("setPublished", () => {
    expectIdempotent(empty, { kind: "setPublished", published: true });
  });

  it("setTheme", () => {
    expectIdempotent(empty, { kind: "setTheme", theme: { ...DEFAULT_THEME, skin: "clay" } });
  });

  it("addSection", () => {
    expectIdempotent(empty, { kind: "addSection", sectionId: S1, layout: "single" });
  });

  it("deleteSection", () => {
    expectIdempotent(oneSection, { kind: "deleteSection", sectionId: S1 });
  });

  it("moveSection", () => {
    expectIdempotent(three, {
      kind: "moveSection",
      sectionId: S1,
      direction: "down",
      fromIndex: 0,
    });
  });

  it("setSectionLayout", () => {
    expectIdempotent(withBlock, { kind: "setSectionLayout", sectionId: S1, layout: "bento" });
  });

  it("addBlock", () => {
    expectIdempotent(oneSection, {
      kind: "addBlock",
      sectionId: S1,
      blockId: B1,
      type: "text",
    });
  });

  it("deleteBlock", () => {
    expectIdempotent(withBlock, { kind: "deleteBlock", blockId: B1 });
  });

  it("moveBlock", () => {
    const two: OwnerSite = {
      ...empty,
      sections: [section(S1, 0, { blocks: [block(B1, S1, 0), block(B2, S1, 1)] })],
    };
    expectIdempotent(two, { kind: "moveBlock", blockId: B1, direction: "down", fromIndex: 0 });
  });

  it("setBlockVisibility", () => {
    expectIdempotent(withBlock, {
      kind: "setBlockVisibility",
      blockId: B1,
      visibility: "private",
    });
  });

  it("setBlockStyle", () => {
    expectIdempotent(withBlock, {
      kind: "setBlockStyle",
      blockId: B1,
      style: { ...DEFAULT_BLOCK_STYLE, tone: "accent" },
    });
  });

  it("saveBlockContent", () => {
    expectIdempotent(withBlock, {
      kind: "saveBlockContent",
      blockId: B1,
      content: { doc: { v: 1, nodes: [] } },
    });
  });

  it("setSplitRatio", () => {
    const bento = apply(
      apply(withBlock, { kind: "setSectionLayout", sectionId: S1, layout: "bento" }),
      { kind: "addBlock", sectionId: S1, blockId: B2, type: "text" },
    );
    expectIdempotent(bento, { kind: "setSplitRatio", sectionId: S1, path: [], ratio: 0.7 });
  });
});

describe("moveSection", () => {
  const three: OwnerSite = {
    ...empty,
    sections: [section(S1, 0), section(S2, 1), section(S3, 2)],
  };

  const order = (site: OwnerSite) => site.sections.map((s) => s.id);

  it("swaps with its neighbour", () => {
    const moved = apply(three, {
      kind: "moveSection",
      sectionId: S1,
      direction: "down",
      fromIndex: 0,
    });
    expect(order(moved)).toEqual([S2, S1, S3]);
  });

  it("keeps sort_order consistent with the rendered order", () => {
    const moved = apply(three, {
      kind: "moveSection",
      sectionId: S3,
      direction: "up",
      fromIndex: 2,
    });
    // The next move's fromIndex is read off the array; a sort_order that
    // disagreed with it would make the following move a no-op on the server.
    expect(moved.sections.map((s) => s.sort_order)).toEqual([0, 1, 2]);
  });

  /**
   * The reason `fromIndex` exists. Without it a resent move — which the queue
   * cannot avoid, having no way to tell a lost reply from a lost request —
   * would walk the section a second place.
   */
  it("refuses to move a section that is no longer where the edit was made", () => {
    const moved = apply(three, {
      kind: "moveSection",
      sectionId: S1,
      direction: "down",
      fromIndex: 0,
    });
    const again = apply(moved, {
      kind: "moveSection",
      sectionId: S1,
      direction: "down",
      fromIndex: 0,
    });
    expect(order(again)).toEqual([S2, S1, S3]);
  });

  it("is a no-op at either end", () => {
    const up = apply(three, {
      kind: "moveSection",
      sectionId: S1,
      direction: "up",
      fromIndex: 0,
    });
    expect(order(up)).toEqual([S1, S2, S3]);
  });
});

/**
 * Moving a block, which is a different problem from moving a section.
 *
 * A section's order is one list. A block's depends on the layout it lives in —
 * `sort_order` for three of the four, the cell tree for a bento — so the same
 * mutation has to step through whichever of the two the section actually renders
 * by, and leave the other one coherent.
 */
describe("moveBlock", () => {
  const stacked = (): OwnerSite => ({
    ...empty,
    sections: [
      section(S1, 0, {
        blocks: [block(B1, S1, 0), block(B2, S1, 1), block(B3, S1, 2)],
      }),
    ],
  });

  const order = (site: OwnerSite) => site.sections[0].blocks.map((b) => b.id);

  it("swaps with its neighbour", () => {
    const moved = apply(stacked(), {
      kind: "moveBlock",
      blockId: B1,
      direction: "down",
      fromIndex: 0,
    });
    expect(order(moved)).toEqual([B2, B1, B3]);
  });

  it("moves the other way too", () => {
    const moved = apply(stacked(), {
      kind: "moveBlock",
      blockId: B3,
      direction: "up",
      fromIndex: 2,
    });
    expect(order(moved)).toEqual([B1, B3, B2]);
  });

  it("keeps sort_order agreeing with the rendered order", () => {
    const moved = apply(stacked(), {
      kind: "moveBlock",
      blockId: B1,
      direction: "down",
      fromIndex: 0,
    });
    // The array is what the editor draws and `sort_order` is what the next read
    // sorts by. If they disagree the move survives until the page reloads.
    expect(moved.sections[0].blocks.map((b) => b.sort_order)).toEqual([0, 1, 2]);
  });

  /**
   * The collision `addBlock` can produce on its own: it numbers a new block by
   * the section's block COUNT, so deleting from the middle and adding again
   * gives two blocks the same number. Swapping two equal values is a button that
   * does nothing, which is why the move renumbers instead.
   */
  it("moves blocks whose sort_order values collide", () => {
    const duplicated: OwnerSite = {
      ...empty,
      sections: [
        section(S1, 0, {
          blocks: [block(B1, S1, 0), block(B2, S1, 2), block(B3, S1, 2)],
        }),
      ],
    };

    const moved = apply(duplicated, {
      kind: "moveBlock",
      blockId: B2,
      direction: "down",
      fromIndex: 1,
    });

    expect(order(moved)).toEqual([B1, B3, B2]);
    expect(moved.sections[0].blocks.map((b) => b.sort_order)).toEqual([0, 1, 2]);
  });

  it("refuses to move a block that is no longer where the edit was made", () => {
    const moved = apply(stacked(), {
      kind: "moveBlock",
      blockId: B1,
      direction: "down",
      fromIndex: 0,
    });
    const again = apply(moved, {
      kind: "moveBlock",
      blockId: B1,
      direction: "down",
      fromIndex: 0,
    });
    expect(order(again)).toEqual([B2, B1, B3]);
  });

  it("is a no-op at either end", () => {
    expect(
      order(apply(stacked(), { kind: "moveBlock", blockId: B1, direction: "up", fromIndex: 0 })),
    ).toEqual([B1, B2, B3]);
    expect(
      order(apply(stacked(), { kind: "moveBlock", blockId: B3, direction: "down", fromIndex: 2 })),
    ).toEqual([B1, B2, B3]);
  });

  it("is a no-op for a block that has gone", () => {
    const site = apply(empty, {
      kind: "moveBlock",
      blockId: B1,
      direction: "up",
      fromIndex: 1,
    });
    expect(site).toEqual(empty);
  });

  it("has nothing to do in a section holding one block", () => {
    // Which is how the permanent identity section is covered: it holds exactly
    // one block and always will, so there is no swap to refuse.
    const site: OwnerSite = {
      ...empty,
      sections: [pinnedSection(S1, [block(B1, S1, 0)])],
    };
    expect(
      apply(site, { kind: "moveBlock", blockId: B1, direction: "down", fromIndex: 0 }),
    ).toEqual(site);
  });

  describe("in a bento", () => {
    const bento = (): OwnerSite => {
      let site: OwnerSite = { ...empty, sections: [section(S1, 0, { layout_type: "bento" })] };
      for (const b of [B1, B2, B3]) {
        site = apply(site, { kind: "addBlock", sectionId: S1, blockId: b, type: "text" });
      }
      return site;
    };

    const leaves = (site: OwnerSite) => cellLeaves(parseCell(site.sections[0].root_cell)!);

    it("steps through the tree, not through sort_order", () => {
      const site = bento();
      const before = leaves(site);

      const moved = apply(site, {
        kind: "moveBlock",
        blockId: before[2],
        direction: "up",
        fromIndex: 2,
      });

      expect(leaves(moved)).toEqual([before[0], before[2], before[1]]);
    });

    /**
     * The tree and the block list are two records of the same thing and the
     * server refuses to store a pair that disagrees. A swap cannot break that —
     * it changes no leaf's existence — but the local apply has to produce the
     * same pair the server will, or the draft shows a layout about to be
     * rejected.
     */
    it("leaves the tree's leaves equal to the section's blocks", () => {
      const moved = apply(bento(), {
        kind: "moveBlock",
        blockId: B1,
        direction: "down",
        fromIndex: 0,
      });
      const [only] = moved.sections;
      expect(cellLeaves(parseCell(only.root_cell)!).sort()).toEqual(
        only.blocks.map((b) => b.id).sort(),
      );
    });

    it("does not disturb the stored arrangement of a section that is no longer a bento", () => {
      // A tree is kept when the layout switches away, so switching back
      // restores it. While the section is stacked the numbers are what renders,
      // and rewriting the tree from a move made in that view would scramble the
      // very thing being kept.
      const site = apply(bento(), {
        kind: "setSectionLayout",
        sectionId: S1,
        layout: "single",
      });
      const before = leaves(site);

      const moved = apply(site, {
        kind: "moveBlock",
        blockId: site.sections[0].blocks[0].id,
        direction: "down",
        fromIndex: 0,
      });

      expect(leaves(moved)).toEqual(before);
      expect(moved.sections[0].blocks.map((b) => b.id)).not.toEqual(
        site.sections[0].blocks.map((b) => b.id),
      );
    });
  });
});

describe("addBlock", () => {
  const bento = (): OwnerSite => ({
    ...empty,
    sections: [section(S1, 0, { layout_type: "bento" })],
  });

  it("puts the block in the section and in the tree", () => {
    const site = apply(bento(), {
      kind: "addBlock",
      sectionId: S1,
      blockId: B1,
      type: "text",
    });

    expect(site.sections[0].blocks.map((b) => b.id)).toEqual([B1]);
    expect(cellLeaves(parseCell(site.sections[0].root_cell)!)).toEqual([B1]);
  });

  /**
   * The tree and the block list are two records of the same thing, and the
   * server refuses to store a pair that disagrees. The local apply has to
   * produce the same pair or the optimistic draft would show a layout the
   * server is about to reject.
   */
  it("keeps the tree's leaves equal to the section's blocks", () => {
    let site = bento();
    for (const b of [B1, B2, B3]) {
      site = apply(site, { kind: "addBlock", sectionId: S1, blockId: b, type: "text" });
    }
    site = apply(site, { kind: "deleteBlock", blockId: B2 });

    const [only] = site.sections;
    expect(cellLeaves(parseCell(only.root_cell)!).sort()).toEqual(
      only.blocks.map((b) => b.id).sort(),
    );
  });

  it("splits at the named block when asked", () => {
    let site = apply(bento(), { kind: "addBlock", sectionId: S1, blockId: B1, type: "text" });
    site = apply(site, {
      kind: "addBlock",
      sectionId: S1,
      blockId: B2,
      type: "text",
      splitFrom: { blockId: B1, direction: "row" },
    });

    const tree = parseCell(site.sections[0].root_cell)!;
    expect(tree.type).toBe("split");
    expect(tree.type === "split" && tree.direction).toBe("row");
    expect(cellLeaves(tree)).toEqual([B1, B2]);
  });

  it("gives a new block the same starter content the server writes", () => {
    const site = apply(bento(), {
      kind: "addBlock",
      sectionId: S1,
      blockId: B1,
      type: "links",
    });
    expect(site.sections[0].blocks[0].content).toEqual({ items: [] });
  });

  it("is a no-op when its section has gone", () => {
    const site = apply(empty, { kind: "addBlock", sectionId: S1, blockId: B1, type: "text" });
    expect(site).toEqual(empty);
  });
});

describe("applyMutation — refusals", () => {
  /**
   * Refused rather than queued, because offline "later" can be tomorrow and a
   * reason that arrives then is attached to an edit nobody remembers making.
   */
  it("explains a bento that cannot hold another split", () => {
    let site: OwnerSite = { ...empty, sections: [section(S1, 0, { layout_type: "bento" })] };
    // A chain of splits down one spine hits the depth cap well before the leaf
    // cap, which is the case a user actually reaches by pressing "split below".
    let previous = B1;
    site = apply(site, { kind: "addBlock", sectionId: S1, blockId: B1, type: "text" });

    for (let i = 0; i < 8; i += 1) {
      const next = id(100 + i);
      const result = applyMutation(site, {
        kind: "addBlock",
        sectionId: S1,
        blockId: next,
        type: "text",
        splitFrom: { blockId: previous, direction: "col" },
      });

      if (!result.ok) {
        expect(result.message).toMatch(/deeply divided/);
        return;
      }
      site = result.site;
      previous = next;
    }

    throw new Error("expected the depth cap to be reached");
  });
});

/**
 * The permanent identity section (site-spec S3).
 *
 * /u/{handle} has no app-drawn contact card any more: the person's name and
 * photo come from the pinned section of their own site, so "this section always
 * exists and is always first" stopped being a nicety and became the thing that
 * keeps a public page identifiable. RLS enforces it on the server; these are the
 * local half, which is what a queue that runs offline for an hour depends on.
 */
describe("applyMutation — the pinned section", () => {
  const withPinned: OwnerSite = {
    ...empty,
    sections: [pinnedSection(S1, [block(B1, S1)]), section(S2, 0), section(S3, 1)],
  };

  it("refuses to delete it", () => {
    const result = applyMutation(withPinned, { kind: "deleteSection", sectionId: S1 });
    expect(result.ok).toBe(false);
  });

  it("refuses to delete the block inside it", () => {
    const result = applyMutation(withPinned, { kind: "deleteBlock", blockId: B1 });
    expect(result.ok).toBe(false);
  });

  it("refuses to hide it from strangers", () => {
    const result = applyMutation(withPinned, {
      kind: "setBlockVisibility",
      blockId: B1,
      visibility: "connections",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses another block in it", () => {
    const result = applyMutation(withPinned, {
      kind: "addBlock",
      sectionId: S1,
      blockId: B2,
      type: "text",
    });
    expect(result.ok).toBe(false);
  });

  it("leaves it alone when the section below tries to move up past it", () => {
    // The editor disables this button; a queued edit written before the identity
    // existed would not know to. Both ends of the swap are checked, so this is a
    // no-op rather than a reordering that puts a name mid-page.
    const moved = apply(withPinned, {
      kind: "moveSection",
      sectionId: S2,
      direction: "up",
      fromIndex: 1,
    });
    expect(moved.sections.map((s) => s.id)).toEqual([S1, S2, S3]);
  });

  it("still reorders the ordinary sections among themselves", () => {
    const moved = apply(withPinned, {
      kind: "moveSection",
      sectionId: S2,
      direction: "down",
      fromIndex: 1,
    });
    expect(moved.sections.map((s) => s.id)).toEqual([S1, S3, S2]);
  });

  it("styles and content still apply to it", () => {
    const styled = apply(withPinned, {
      kind: "saveBlockContent",
      blockId: B1,
      content: { tagline: "Designer" },
    });
    expect(styled.sections[0].blocks[0].content).toEqual({ tagline: "Designer" });
  });
});

describe("applyAll", () => {
  it("skips an entry that no longer applies rather than dropping the rest", () => {
    const site = applyAll({ ...empty, sections: [section(S1, 0)] }, [
      { kind: "addBlock", sectionId: S2, blockId: B1, type: "text" },
      { kind: "setPublished", published: true },
    ]);

    expect(site.published).toBe(true);
  });

  it("folds a realistic session in order", () => {
    const site = applyAll(empty, [
      { kind: "addSection", sectionId: S1, layout: "single" },
      { kind: "addBlock", sectionId: S1, blockId: B1, type: "text" },
      { kind: "saveBlockContent", blockId: B1, content: { doc: { v: 1, nodes: [] } } },
      { kind: "setBlockVisibility", blockId: B1, visibility: "connections" },
      { kind: "setPublished", published: true },
    ]);

    expect(site.published).toBe(true);
    expect(site.sections[0].blocks[0].visibility).toBe("connections");
  });
});

describe("coalesceKey", () => {
  it("gives absolute writes to one target the same key", () => {
    expect(coalesceKey({ kind: "setTheme", theme: DEFAULT_THEME })).toBe(
      coalesceKey({ kind: "setTheme", theme: { ...DEFAULT_THEME, skin: "glass" } }),
    );
    expect(coalesceKey({ kind: "setBlockStyle", blockId: B1, style: DEFAULT_BLOCK_STYLE })).toBe(
      coalesceKey({
        kind: "setBlockStyle",
        blockId: B1,
        style: { ...DEFAULT_BLOCK_STYLE, scale: 1.5 },
      }),
    );
  });

  it("keeps writes to different targets apart", () => {
    expect(coalesceKey({ kind: "setBlockStyle", blockId: B1, style: DEFAULT_BLOCK_STYLE })).not.toBe(
      coalesceKey({ kind: "setBlockStyle", blockId: B2, style: DEFAULT_BLOCK_STYLE }),
    );
  });

  it("never coalesces something that happened", () => {
    // Two "add a block" are two blocks, not one block described twice.
    expect(coalesceKey({ kind: "addBlock", sectionId: S1, blockId: B1, type: "text" })).toBeNull();
    expect(coalesceKey({ kind: "deleteBlock", blockId: B1 })).toBeNull();
    expect(
      coalesceKey({ kind: "moveSection", sectionId: S1, direction: "up", fromIndex: 1 }),
    ).toBeNull();
    // Two moves are two places along, not one place described twice.
    expect(
      coalesceKey({ kind: "moveBlock", blockId: B1, direction: "up", fromIndex: 1 }),
    ).toBeNull();
  });
});

describe("isSiteMutation", () => {
  /**
   * The gate on the persisted queue. A queue written by one deploy is read back
   * by the next, so an unknown kind is a real case rather than a hypothetical —
   * and `applyMutation`'s switch is exhaustive with no default, so one reaching
   * it would return undefined and take the editor down on first render.
   */
  it("rejects a kind this build has never heard of", () => {
    expect(isSiteMutation({ kind: "setBackgroundVideo", url: "x" })).toBe(false);
    expect(isSiteMutation({})).toBe(false);
    expect(isSiteMutation(null)).toBe(false);
    expect(isSiteMutation("setTheme")).toBe(false);
  });

  it("accepts every kind it can dispatch", () => {
    expect(isSiteMutation({ kind: "setPublished", published: true })).toBe(true);
    expect(isSiteMutation({ kind: "addBlock", sectionId: S1, blockId: B1, type: "text" })).toBe(
      true,
    );
  });
});

describe("newId", () => {
  it("mints ids the server will accept as uuids", () => {
    const value = newId();
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newId()).not.toBe(value);
  });
});

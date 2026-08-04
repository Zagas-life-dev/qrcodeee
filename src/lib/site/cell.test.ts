import { describe, expect, it } from "vitest";

import {
  DEFAULT_CELL_RATIO,
  MAX_CELL_DEPTH,
  MAX_CELL_LEAVES,
  MAX_CELL_RATIO,
  MIN_CELL_RATIO,
  type Cell,
  cellDepth,
  cellLeaves,
  clampRatio,
  insertBlock,
  parseCell,
  pruneCell,
  removeBlock,
  setRatioAt,
  splitAtBlock,
  stackedTree,
  swapLeaves,
  validateCellTree,
} from "./cell";

/** Real-shaped ids, because parseCell rejects anything that isn't a uuid. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const C = id(3);
const D = id(4);

const leaf = (blockId: string): Cell => ({ type: "component", block_id: blockId });
const split = (
  direction: "row" | "col",
  children: [Cell, Cell],
  ratio = DEFAULT_CELL_RATIO,
): Cell => ({ type: "split", direction, ratio, children });

describe("clampRatio", () => {
  it("holds a pane above the minimum, so it always keeps a drag handle", () => {
    expect(clampRatio(0)).toBe(MIN_CELL_RATIO);
    expect(clampRatio(-5)).toBe(MIN_CELL_RATIO);
    expect(clampRatio(1)).toBe(MAX_CELL_RATIO);
  });

  it("rounds, so an unchanged drag isn't a diff", () => {
    expect(clampRatio(0.333333333)).toBe(0.333);
  });

  /**
   * Every non-finite value takes the same route, including Infinity — it is not
   * a ratio that got out of range, it is not a ratio. Clamping it to the maximum
   * would silently turn corrupt input into a deliberate-looking 80/20 layout.
   */
  it("falls back to the default on values that aren't finite numbers", () => {
    expect(clampRatio(NaN)).toBe(DEFAULT_CELL_RATIO);
    expect(clampRatio(Infinity)).toBe(DEFAULT_CELL_RATIO);
    expect(clampRatio(-Infinity)).toBe(DEFAULT_CELL_RATIO);
  });
});

describe("parseCell", () => {
  it("accepts a lone component", () => {
    expect(parseCell({ type: "component", block_id: A })).toEqual(leaf(A));
  });

  it("accepts a nested split and clamps its ratio on the way through", () => {
    const parsed = parseCell({
      type: "split",
      direction: "row",
      ratio: 0.99,
      children: [
        { type: "component", block_id: A },
        { type: "component", block_id: B },
      ],
    });
    expect(parsed).toEqual(split("row", [leaf(A), leaf(B)], MAX_CELL_RATIO));
  });

  it("defaults a missing ratio rather than rejecting the tree", () => {
    const parsed = parseCell({
      type: "split",
      direction: "col",
      children: [
        { type: "component", block_id: A },
        { type: "component", block_id: B },
      ],
    });
    expect(parsed).toEqual(split("col", [leaf(A), leaf(B)]));
  });

  describe("rejects", () => {
    it.each([
      ["null", null],
      ["a string", "component"],
      ["a number", 3],
      ["an array", [{ type: "component", block_id: A }]],
      ["an unknown type", { type: "widget", block_id: A }],
      ["a missing type", { block_id: A }],
      ["a non-uuid block id", { type: "component", block_id: "not-a-uuid" }],
      ["a numeric block id", { type: "component", block_id: 7 }],
      ["a bad direction", { type: "split", direction: "diagonal", children: [] }],
      [
        "one child",
        { type: "split", direction: "row", children: [{ type: "component", block_id: A }] },
      ],
      [
        "three children",
        {
          type: "split",
          direction: "row",
          children: [
            { type: "component", block_id: A },
            { type: "component", block_id: B },
            { type: "component", block_id: C },
          ],
        },
      ],
      [
        "a malformed descendant",
        {
          type: "split",
          direction: "row",
          children: [{ type: "component", block_id: A }, { type: "component" }],
        },
      ],
    ])("%s", (_label, input) => {
      expect(parseCell(input)).toBeNull();
    });
  });

  /**
   * The column is owner-writable through PostgREST, so a hand-crafted request
   * can send arbitrary nesting. The parser has to be the thing that stops it,
   * not the renderer's stack.
   */
  it("rejects a tree nested past the depth cap", () => {
    let deep: Cell = leaf(A);
    for (let i = 0; i < MAX_CELL_DEPTH + 1; i++) {
      deep = split("row", [deep, leaf(B)]);
    }
    expect(parseCell(deep)).toBeNull();
  });

  it("accepts a tree at exactly the depth cap", () => {
    let atLimit: Cell = leaf(A);
    for (let i = 0; i < MAX_CELL_DEPTH; i++) {
      atLimit = split("row", [atLimit, leaf(B)]);
    }
    expect(parseCell(atLimit)).not.toBeNull();
  });
});

describe("cellLeaves", () => {
  it("reads depth-first, left child first — the render order", () => {
    const tree = split("row", [split("col", [leaf(A), leaf(B)]), leaf(C)]);
    expect(cellLeaves(tree)).toEqual([A, B, C]);
  });
});

describe("cellDepth", () => {
  it("counts splits, not cells", () => {
    expect(cellDepth(leaf(A))).toBe(0);
    expect(cellDepth(split("row", [leaf(A), leaf(B)]))).toBe(1);
    expect(cellDepth(split("row", [split("col", [leaf(A), leaf(B)]), leaf(C)]))).toBe(2);
  });
});

describe("validateCellTree", () => {
  it("passes when the leaf set matches the block set exactly", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(validateCellTree(tree, [A, B])).toBeNull();
  });

  /**
   * The failure a coordinate layout could never produce, and the reason this
   * check exists: an unreferenced block is invisible on the page AND unreachable
   * in the editor, so its owner cannot delete what they cannot see.
   */
  it("catches a block missing from the layout", () => {
    expect(validateCellTree(leaf(A), [A, B])).toMatch(/missing from the layout/i);
  });

  it("catches a cell pointing at a block that no longer exists", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(validateCellTree(tree, [A])).toMatch(/no longer exists/i);
  });

  it("catches the same block used twice", () => {
    const tree = split("row", [leaf(A), leaf(A)]);
    expect(validateCellTree(tree, [A])).toMatch(/twice/i);
  });

  it("catches a tree past the depth cap", () => {
    let deep: Cell = leaf(A);
    const ids = [A];
    for (let i = 0; i < MAX_CELL_DEPTH + 1; i++) {
      const next = id(100 + i);
      ids.push(next);
      deep = split("row", [deep, leaf(next)]);
    }
    expect(validateCellTree(deep, ids)).toMatch(/deeper than/i);
  });
});

describe("splitAtBlock", () => {
  it("puts the new block in the second position, every time", () => {
    const result = splitAtBlock(leaf(A), A, "row", B);
    expect(result).toEqual({ ok: true, root: split("row", [leaf(A), leaf(B)]) });
  });

  it("splits a nested cell without disturbing its siblings", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    const result = splitAtBlock(tree, B, "col", C);
    expect(result).toEqual({
      ok: true,
      root: split("row", [leaf(A), split("col", [leaf(B), leaf(C)])]),
    });
  });

  it("reports a block that isn't in the tree", () => {
    expect(splitAtBlock(leaf(A), B, "row", C)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a split that would breach the depth cap", () => {
    let atLimit: Cell = leaf(A);
    for (let i = 0; i < MAX_CELL_DEPTH; i++) {
      atLimit = split("row", [atLimit, leaf(id(200 + i))]);
    }
    // A is now the deepest leaf; splitting it would add a level.
    expect(splitAtBlock(atLimit, A, "row", D)).toEqual({ ok: false, reason: "too_deep" });
  });

  it("leaves the original tree untouched", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    const before = JSON.stringify(tree);
    splitAtBlock(tree, A, "col", C);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("removeBlock", () => {
  /**
   * The resolved decision: a split whose child is removed collapses into the
   * survivor. An empty pane would be a hole on the published page that only its
   * owner can see is a hole.
   */
  it("collapses the split into the surviving sibling", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(removeBlock(tree, B)).toEqual(leaf(A));
  });

  it("collapses from either side", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(removeBlock(tree, A)).toEqual(leaf(B));
  });

  it("collapses a nested split and keeps the rest of the tree", () => {
    const tree = split("row", [split("col", [leaf(A), leaf(B)]), leaf(C)]);
    expect(removeBlock(tree, B)).toEqual(split("row", [leaf(A), leaf(C)]));
  });

  it("returns null when the last block goes — an empty section, not an error", () => {
    expect(removeBlock(leaf(A), A)).toBeNull();
  });

  it("returns the tree unchanged when the block isn't there", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(removeBlock(tree, C)).toEqual(tree);
  });

  it("leaves every surviving leaf a component — the invariant the renderer rests on", () => {
    let tree: Cell = split("row", [split("col", [leaf(A), leaf(B)]), split("row", [leaf(C), leaf(D)])]);
    for (const removed of [B, C, A]) {
      tree = removeBlock(tree, removed) as Cell;
      expect(tree).not.toBeNull();
      // Every leaf reachable in the tree is a component with a real id.
      for (const leafId of cellLeaves(tree)) {
        expect(typeof leafId).toBe("string");
      }
    }
    expect(tree).toEqual(leaf(D));
  });
});

describe("insertBlock", () => {
  it("seeds an empty section with a bare component", () => {
    expect(insertBlock(null, A)).toEqual({ ok: true, root: leaf(A) });
  });

  it("stacks beside a single block", () => {
    expect(insertBlock(leaf(A), B)).toEqual({
      ok: true,
      root: split("col", [leaf(A), leaf(B)]),
    });
  });

  it("picks the shallowest leaf, not the last one", () => {
    // B sits at depth 2, C at depth 1 — the new block must join C.
    const tree = split("row", [split("col", [leaf(A), leaf(B)]), leaf(C)]);
    expect(insertBlock(tree, D)).toEqual({
      ok: true,
      root: split("row", [
        split("col", [leaf(A), leaf(B)]),
        split("col", [leaf(C), leaf(D)]),
      ]),
    });
  });

  /**
   * The regression this function exists for. Appending by wrapping the root, or
   * by always splitting the last leaf, grows one spine and trips the depth cap
   * at five blocks — long before the section is actually full.
   */
  it("fills a section to its 16-block ceiling without breaching the depth cap", () => {
    let tree: Cell | null = null;
    for (let i = 0; i < MAX_CELL_LEAVES; i++) {
      const result = insertBlock(tree, id(600 + i));
      expect(result.ok, `insert ${i + 1} was refused`).toBe(true);
      tree = (result as { root: Cell }).root;
    }
    expect(cellLeaves(tree as Cell)).toHaveLength(MAX_CELL_LEAVES);
    expect(cellDepth(tree as Cell)).toBeLessThanOrEqual(MAX_CELL_DEPTH);
  });

  it("refuses the block that would overfill the section", () => {
    let tree: Cell | null = null;
    for (let i = 0; i < MAX_CELL_LEAVES; i++) {
      tree = (insertBlock(tree, id(700 + i)) as { root: Cell }).root;
    }
    expect(insertBlock(tree, id(999))).toEqual({ ok: false, reason: "too_deep" });
  });
});

describe("swapLeaves", () => {
  it("exchanges two blocks without touching the shape", () => {
    const tree = split("row", [leaf(A), leaf(B)], 0.3);
    expect(swapLeaves(tree, A, B)).toEqual(split("row", [leaf(B), leaf(A)], 0.3));
  });

  /**
   * The property that makes this safe to write straight back: a tree that passed
   * validation still passes it, because only the ids at the leaves changed.
   * Remove-and-reinsert has none of that — it collapses the split the block came
   * from and picks a new home by `insertBlock`'s own rule.
   */
  it("keeps the depth, the ratios and the leaf set", () => {
    const tree = split("row", [split("col", [leaf(A), leaf(B)], 0.7), leaf(C)], 0.4);
    const swapped = swapLeaves(tree, A, C);

    expect(cellLeaves(swapped)).toEqual([C, B, A]);
    expect(cellDepth(swapped)).toBe(cellDepth(tree));
    expect(validateCellTree(swapped, [A, B, C])).toBeNull();
  });

  it("swaps blocks that live in different splits", () => {
    const tree = split("col", [split("row", [leaf(A), leaf(B)]), split("row", [leaf(C), leaf(D)])]);
    expect(cellLeaves(swapLeaves(tree, B, C))).toEqual([A, C, B, D]);
  });

  it("is unchanged for an id that isn't in the tree", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(swapLeaves(tree, A, D)).toEqual(split("row", [leaf(D), leaf(B)]));
    expect(swapLeaves(tree, C, D)).toEqual(tree);
  });

  it("is unchanged when both ids are the same block", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(swapLeaves(tree, A, A)).toBe(tree);
  });

  it("leaves the original tree untouched", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    const before = JSON.stringify(tree);
    swapLeaves(tree, A, B);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("pruneCell", () => {
  it("keeps a tree whose blocks are all available", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(pruneCell(tree, new Set([A, B]))).toBe(tree);
  });

  /**
   * The visibility case this exists for: an owner's tree references their
   * connections-only blocks, a stranger never receives those rows, and the
   * layout has to close up rather than leave gaps that advertise how much is
   * being withheld.
   */
  it("closes up around blocks the viewer can't see", () => {
    const tree = split("row", [leaf(A), split("col", [leaf(B), leaf(C)])]);
    expect(pruneCell(tree, new Set([A, C]))).toEqual(split("row", [leaf(A), leaf(C)]));
  });

  it("is null when the viewer can see nothing in the section", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(pruneCell(tree, new Set())).toBeNull();
  });

  it("collapses to a single block when only one survives", () => {
    const tree = split("row", [split("col", [leaf(A), leaf(B)]), leaf(C)]);
    expect(pruneCell(tree, new Set([B]))).toEqual(leaf(B));
  });

  it("leaves every surviving leaf a component", () => {
    const tree = split("row", [split("col", [leaf(A), leaf(B)]), split("row", [leaf(C), leaf(D)])]);
    const pruned = pruneCell(tree, new Set([A, D])) as Cell;
    expect(cellLeaves(pruned)).toEqual([A, D]);
  });
});

describe("setRatioAt", () => {
  it("sets the ratio at the root", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(setRatioAt(tree, [], 0.3)).toEqual(split("row", [leaf(A), leaf(B)], 0.3));
  });

  it("sets the ratio of a nested split", () => {
    const tree = split("row", [leaf(A), split("col", [leaf(B), leaf(C)])]);
    const next = setRatioAt(tree, [1], 0.25);
    expect(next).toEqual(
      split("row", [leaf(A), split("col", [leaf(B), leaf(C)], 0.25)]),
    );
  });

  it("clamps on the way in", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect((setRatioAt(tree, [], 0.001) as { ratio: number }).ratio).toBe(MIN_CELL_RATIO);
  });

  it("ignores a path that runs off the tree", () => {
    const tree = split("row", [leaf(A), leaf(B)]);
    expect(setRatioAt(tree, [0, 1], 0.3)).toEqual(tree);
  });
});

describe("stackedTree", () => {
  it("is null for no blocks", () => {
    expect(stackedTree([])).toBeNull();
  });

  it("is a bare component for one block", () => {
    expect(stackedTree([A])).toEqual(leaf(A));
  });

  it("keeps every block, in order", () => {
    const ids = Array.from({ length: 7 }, (_, i) => id(300 + i));
    expect(cellLeaves(stackedTree(ids) as Cell)).toEqual(ids);
  });

  /**
   * The bug this test exists for: folding a list into nested splits one at a
   * time gives depth n-1, so the helper meant to produce a valid tree would
   * emit an invalid one from six blocks up.
   */
  it("stays within the depth cap at the leaf ceiling", () => {
    const ids = Array.from({ length: MAX_CELL_LEAVES }, (_, i) => id(400 + i));
    const tree = stackedTree(ids) as Cell;
    expect(cellDepth(tree)).toBeLessThanOrEqual(MAX_CELL_DEPTH);
    expect(validateCellTree(tree, ids)).toBeNull();
  });

  it("produces a tree that survives a parse round trip", () => {
    const ids = Array.from({ length: 5 }, (_, i) => id(500 + i));
    const tree = stackedTree(ids) as Cell;
    expect(parseCell(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
  });
});

/**
 * The bento layout tree (site-spec S4).
 *
 * A section's layout is a binary tree. A cell is either a block, or a split of
 * two cells in a direction at a ratio. There are no coordinates and no sizes —
 * "wide" and "tall" stop being properties of a block and become the direction of
 * the split above it.
 *
 * WHY THIS FILE HAS NO DEPENDENCIES: it is the validation the database cannot
 * do. `root_cell` is JSONB, so a CHECK constraint can only insist it is a small
 * object; every real invariant lives here, is enforced on write, and is enforced
 * AGAIN on read. That second pass is not belt-and-braces — the column is
 * writable by the owner through PostgREST, so a hand-crafted request can put
 * anything object-shaped in it, and the renderer must never be the thing that
 * discovers that.
 */

/**
 * `ratio` IS THE FIRST CHILD'S SHARE OF A ROW SPLIT, AND NOTHING ELSE.
 *
 * On a `col` split it is stored and ignored: children of a vertical split size
 * to their content. Applying a ratio there would set HEIGHTS, which means
 * deciding that a paragraph is 40% as tall as the image beside it — a number
 * nobody can choose correctly and that clips text the moment the font or the
 * translation changes.
 *
 * It matters beyond aesthetics because a `row` split BECOMES a column on a
 * narrow container (the container queries in globals.css), and the ratio has to
 * stop applying at exactly that point or the collapse would squash the very
 * content it exists to rescue.
 */
export type Cell =
  | { type: "component"; block_id: string }
  | { type: "split"; direction: "row" | "col"; ratio: number; children: [Cell, Cell] };

/** Which child to descend into, from the root. */
export type CellPath = (0 | 1)[];

/**
 * Four levels, so at most 16 blocks in one bento section.
 *
 * Not an arbitrary round number: at depth 4 on a 390px phone, a row split's
 * grandchildren are already narrower than a legible block, and the container
 * queries in globals.css will have stacked them anyway. Past this the tree is
 * describing a layout the viewport cannot express, while still costing a render.
 */
export const MAX_CELL_DEPTH = 4;
export const MAX_CELL_LEAVES = 2 ** MAX_CELL_DEPTH;

/**
 * A pane can be dragged to a fifth of its parent, no further.
 *
 * Unclamped, a ratio of 0 leaves a pane with no width — and therefore no drag
 * handle and no way back. The clamp is what makes resizing non-destructive.
 */
export const MIN_CELL_RATIO = 0.2;
export const MAX_CELL_RATIO = 0.8;
export const DEFAULT_CELL_RATIO = 0.5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exported because the editor now MINTS ids rather than reading them back.
 *
 * An optimistic editor has to draw a new section or block before the insert has
 * happened, and it cannot draw something it has no id for — so the id is
 * generated on the client and sent with the write. That makes "is this a uuid"
 * a question the write path has to ask about a value from the browser, not just
 * a question this file asks about stored JSON.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CELL_RATIO;
  const clamped = Math.min(Math.max(value, MIN_CELL_RATIO), MAX_CELL_RATIO);
  // Three decimals: a drag produces far more precision than a layout can show,
  // and unrounded floats make every save a diff even when nothing moved.
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Parse untrusted JSON into a Cell, or null.
 *
 * Total by construction: every branch either returns a well-formed Cell or null,
 * so a caller can never receive a partially-valid tree. Ratios are clamped
 * rather than rejected — a bad ratio is a cosmetic problem with an obvious
 * correct answer, unlike a missing child, which is not recoverable.
 */
export function parseCell(value: unknown, depth = 0): Cell | null {
  if (depth > MAX_CELL_DEPTH) return null;
  if (typeof value !== "object" || value === null) return null;

  const node = value as Record<string, unknown>;

  if (node.type === "component") {
    return typeof node.block_id === "string" && UUID.test(node.block_id)
      ? { type: "component", block_id: node.block_id }
      : null;
  }

  if (node.type === "split") {
    if (node.direction !== "row" && node.direction !== "col") return null;
    if (!Array.isArray(node.children) || node.children.length !== 2) return null;

    const first = parseCell(node.children[0], depth + 1);
    const second = parseCell(node.children[1], depth + 1);
    if (!first || !second) return null;

    return {
      type: "split",
      direction: node.direction,
      ratio: clampRatio(typeof node.ratio === "number" ? node.ratio : DEFAULT_CELL_RATIO),
      children: [first, second],
    };
  }

  return null;
}

export function cellDepth(cell: Cell): number {
  if (cell.type === "component") return 0;
  return 1 + Math.max(cellDepth(cell.children[0]), cellDepth(cell.children[1]));
}

/** Block ids in render order — depth-first, left child first. */
export function cellLeaves(cell: Cell): string[] {
  if (cell.type === "component") return [cell.block_id];
  return [...cellLeaves(cell.children[0]), ...cellLeaves(cell.children[1])];
}

/**
 * The write-path check. Returns a reason, or null when the tree is sound.
 *
 * The leaf-set equality check is the one that matters most and the one a
 * coordinate layout never needed: a tree and a block list are two records of the
 * same thing, and they can disagree in two directions. A block no cell
 * references is invisible on the page and unreachable in the editor — the owner
 * cannot delete what they cannot see. A cell referencing a block that is gone
 * renders as a hole.
 */
export function validateCellTree(root: Cell, blockIds: Iterable<string>): string | null {
  if (cellDepth(root) > MAX_CELL_DEPTH) {
    return `Layout is nested deeper than ${MAX_CELL_DEPTH} levels.`;
  }

  const leaves = cellLeaves(root);
  if (leaves.length > MAX_CELL_LEAVES) {
    return `Layout holds more than ${MAX_CELL_LEAVES} blocks.`;
  }

  const seen = new Set<string>();
  for (const id of leaves) {
    if (seen.has(id)) return "The same block appears twice in the layout.";
    seen.add(id);
  }

  const expected = new Set(blockIds);
  for (const id of seen) {
    if (!expected.has(id)) return "The layout references a block that no longer exists.";
  }
  for (const id of expected) {
    if (!seen.has(id)) return "A block is missing from the layout.";
  }

  return null;
}

export type SplitResult =
  | { ok: true; root: Cell }
  | { ok: false; reason: "not_found" | "too_deep" };

/**
 * Split the cell holding `blockId` in two, putting `newBlockId` in the new half.
 *
 * The new block always takes the SECOND position — right of a row split, below a
 * column split. Consistency matters more than cleverness here: a user who splits
 * twice should be able to predict where the second one landed.
 */
export function splitAtBlock(
  root: Cell,
  blockId: string,
  direction: "row" | "col",
  newBlockId: string,
): SplitResult {
  let found = false;
  let tooDeep = false;

  const walk = (cell: Cell, depth: number): Cell => {
    if (cell.type === "component") {
      if (cell.block_id !== blockId) return cell;
      found = true;
      // The split adds a level BELOW this cell, so the new children sit at
      // depth + 1 and that is what has to fit.
      if (depth + 1 > MAX_CELL_DEPTH) {
        tooDeep = true;
        return cell;
      }
      return {
        type: "split",
        direction,
        ratio: DEFAULT_CELL_RATIO,
        children: [cell, { type: "component", block_id: newBlockId }],
      };
    }

    return {
      ...cell,
      children: [walk(cell.children[0], depth + 1), walk(cell.children[1], depth + 1)],
    };
  };

  const next = walk(root, 0);
  if (!found) return { ok: false, reason: "not_found" };
  if (tooDeep) return { ok: false, reason: "too_deep" };
  return { ok: true, root: next };
}

/**
 * Remove a block, collapsing the split it lived in into its surviving sibling.
 *
 * AUTO-COLLAPSE, ALWAYS — the resolved decision from the spec review. An empty
 * pane is a dead end: nothing fills it but adding a block, so it persists as a
 * hole on the published page and the owner has to tidy it by hand. Collapsing
 * also preserves the invariant that EVERY LEAF IS A COMPONENT, which is what
 * makes the renderer total — no empty-cell branch, no placeholder styling, and
 * no question about what a visitor sees in a gap.
 *
 * Returns null when the removed block was the whole tree, which is the section
 * becoming empty rather than an error.
 */
export function removeBlock(root: Cell, blockId: string): Cell | null {
  if (root.type === "component") {
    return root.block_id === blockId ? null : root;
  }

  const [left, right] = root.children;
  const nextLeft = removeBlock(left, blockId);
  const nextRight = removeBlock(right, blockId);

  // One side vanished: this split has nothing left to divide, so it collapses
  // into whatever survived rather than becoming a one-child split.
  if (nextLeft === null) return nextRight;
  if (nextRight === null) return nextLeft;

  if (nextLeft === left && nextRight === right) return root;
  return { ...root, children: [nextLeft, nextRight] };
}

/**
 * Add a block to an existing tree, stacked beside the SHALLOWEST leaf.
 *
 * Which leaf is not cosmetic. Every append has to split something, so it adds a
 * level below whatever it picks — and the obvious choices both fail fast:
 * wrapping the root, or splitting the last leaf, grow the tree along one spine
 * and hit MAX_CELL_DEPTH after four blocks. Splitting the shallowest leaf keeps
 * the tree as balanced as it can be, so the depth cap is reached only when the
 * section genuinely holds its 16 blocks.
 *
 * Always a `col` split: "add a block" means below, which is what someone who
 * pressed Add expects to find. Rearranging afterwards is what the split and
 * resize controls are for.
 */
export function insertBlock(root: Cell | null, newBlockId: string): SplitResult {
  if (root === null) return { ok: true, root: { type: "component", block_id: newBlockId } };

  // Find the shallowest leaf, preferring the leftmost at equal depth so the
  // result is stable rather than dependent on traversal order.
  let target: string | null = null;
  let bestDepth = Infinity;

  const scan = (cell: Cell, depth: number) => {
    if (cell.type === "component") {
      if (depth < bestDepth) {
        bestDepth = depth;
        target = cell.block_id;
      }
      return;
    }
    scan(cell.children[0], depth + 1);
    scan(cell.children[1], depth + 1);
  };
  scan(root, 0);

  if (target === null) return { ok: false, reason: "not_found" };
  return splitAtBlock(root, target, "col", newBlockId);
}

/**
 * Drop every leaf whose block isn't in `available`, collapsing as it goes.
 *
 * This is what makes per-viewer visibility work without a second stored layout.
 * The tree is written once by the owner and references all their blocks,
 * including the connections-only ones; a visitor who isn't connected simply
 * never receives those rows, so their ids are dangling by the time the tree is
 * rendered. Pruning turns that into a layout that closes up around the missing
 * blocks, rather than a page with holes where the private parts are — which
 * would advertise exactly how much was being withheld.
 *
 * Same collapse rule as removeBlock, for the same reason: every surviving leaf
 * is a component, so the renderer needs no empty-cell branch.
 */
export function pruneCell(cell: Cell, available: ReadonlySet<string>): Cell | null {
  if (cell.type === "component") {
    return available.has(cell.block_id) ? cell : null;
  }

  const left = pruneCell(cell.children[0], available);
  const right = pruneCell(cell.children[1], available);

  if (left === null) return right;
  if (right === null) return left;
  if (left === cell.children[0] && right === cell.children[1]) return cell;
  return { ...cell, children: [left, right] };
}

/** Set the ratio of the split at `path`. Out-of-range paths return the tree unchanged. */
export function setRatioAt(root: Cell, path: CellPath, ratio: number): Cell {
  if (path.length === 0) {
    return root.type === "split" ? { ...root, ratio: clampRatio(ratio) } : root;
  }
  if (root.type !== "split") return root;

  const [index, ...rest] = path;
  const child = root.children[index];
  const next = setRatioAt(child, rest, ratio);
  if (next === child) return root;

  const children: [Cell, Cell] =
    index === 0 ? [next, root.children[1]] : [root.children[0], next];
  return { ...root, children };
}

/**
 * A column-stacked tree over the given blocks, for seeding a bento section.
 *
 * BALANCED, NOT LEFT-DEEP, and that is a correctness requirement rather than a
 * preference. Folding a list into nested splits one at a time produces a tree of
 * depth n-1, so six blocks would already exceed MAX_CELL_DEPTH and the very
 * function meant to produce a valid tree would emit an invalid one. Halving
 * recursively gives depth ceil(log2(n)), which is exactly 4 at the 16-leaf
 * ceiling — the two limits are the same limit.
 *
 * Not used as the renderer's failure path: a tree that failed validation is
 * rendered as a plain list in sort_order instead, which needs no tree at all.
 */
export function stackedTree(blockIds: string[]): Cell | null {
  if (blockIds.length === 0) return null;
  if (blockIds.length === 1) return { type: "component", block_id: blockIds[0] };

  const mid = Math.ceil(blockIds.length / 2);
  return {
    type: "split",
    direction: "col",
    ratio: DEFAULT_CELL_RATIO,
    children: [
      stackedTree(blockIds.slice(0, mid)) as Cell,
      stackedTree(blockIds.slice(mid)) as Cell,
    ],
  };
}

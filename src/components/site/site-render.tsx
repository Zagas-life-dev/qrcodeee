import { parseCell, pruneCell, type Cell } from "@/lib/site/cell";
import { onAccent, parseTheme } from "@/lib/site/theme";
import type { PublicSite, SiteBlock, SiteOwner } from "@/lib/site/read";

import { BlockRender } from "./block-render";

/**
 * The personal site (site-spec S4), rendered.
 *
 * A SERVER COMPONENT WITH NO CLIENT LIBRARY, deliberately. The tree format is
 * ours; `react-resizable-panels` is an editor implementation detail and must
 * never reach this file. /u/{handle} is the highest-traffic route in the product
 * and cannot carry an editor's dependency tree to draw a layout that CSS already
 * knows how to draw.
 *
 * The two block sources are merged here rather than at the query layer: public
 * blocks arrive from the cached, viewer-independent read, connections-only
 * blocks from a per-viewer one. By the time they are a single map, nothing
 * downstream needs to know which was which.
 */
export function SiteRender({
  site,
  gatedBlocks,
  owner,
  contact,
}: {
  site: PublicSite;
  gatedBlocks: SiteBlock[];
  owner: SiteOwner;
  /**
   * The contact details panel, slotted between the identity and everything the
   * owner built (see contact-details.tsx).
   *
   * A NODE RATHER THAN DATA, because of where the two halves come from: the site
   * is a cached, viewer-independent read and the details are per-viewer through
   * RLS. Passing phone and email into this component would put viewer-dependent
   * values inside the thing that must stay identical for everybody. Passing the
   * rendered element keeps the split intact and still lets the skin style it —
   * the wrapper below is what carries the theme, and this lands inside it.
   */
  contact?: React.ReactNode;
}) {
  const blocks = new Map<string, SiteBlock>();
  for (const block of [...site.blocks, ...gatedBlocks]) blocks.set(block.id, block);

  const withBlocks = site.sections.filter((section) =>
    [...blocks.values()].some((block) => block.section_id === section.id),
  );

  /**
   * The permanent identity section leads, and the rest follow.
   *
   * Sorted first in the database too (`sort_order` -1), so this split is a
   * guarantee rather than a re-sort: it is what stops a `moveSection` bug, an
   * out-of-order write or a future feature putting the person's name halfway
   * down their own page.
   */
  const pinned = withBlocks.find((section) => section.pinned) ?? null;
  const sections = withBlocks.filter((section) => !section.pinned);

  if (!pinned && sections.length === 0 && !contact) return null;

  // Never null — an unknown or corrupt value falls back to the default rather
  // than rendering an unstyled page. See parseTheme.
  const theme = parseTheme(site.theme);

  return (
    // The skin is TWO DATA ATTRIBUTES, and everything visual hangs off them in
    // globals.css. No inline styles, no class names from the database, nothing
    // interpolated into CSS — the stored value is an id from a closed set, so
    // the worst a hand-written `theme` column can do is pick a different one of
    // six looks we designed.
    <div
      // No top margin of its own: this is the first thing on the page now that
      // the app's contact card no longer precedes it, so the spacing above it
      // belongs to the page.
      className="site-theme site-theme-page flex flex-col"
      data-skin={theme.skin}
      data-font={theme.font}
      data-radius={theme.radius}
      data-density={theme.density}
      // A custom accent overrides the skin's, and its FOREGROUND is computed
      // from it rather than chosen — `onAccent` guarantees at least 4.58:1 for
      // any colour in sRGB, so no pick can produce unreadable text. Omitted
      // entirely when null, which leaves the skin's own pair in place.
      style={
        theme.accent
          ? ({
              "--sk-accent": theme.accent,
              "--sk-on-accent": onAccent(theme.accent),
            } as React.CSSProperties)
          : undefined
      }
    >
      {pinned ? (
        <SectionRender
          owner={owner}
          layout={pinned.layout_type}
          rootCell={pinned.root_cell}
          blocks={[...blocks.values()]
            .filter((block) => block.section_id === pinned.id)
            .sort((a, b) => a.sort_order - b.sort_order)}
        />
      ) : null}

      {contact}

      {sections.map((section) => (
        <SectionRender
          key={section.id}
          owner={owner}
          layout={section.layout_type}
          rootCell={section.root_cell}
          blocks={[...blocks.values()]
            .filter((block) => block.section_id === section.id)
            .sort((a, b) => a.sort_order - b.sort_order)}
        />
      ))}
    </div>
  );
}

function SectionRender({
  layout,
  rootCell,
  blocks,
  owner,
}: {
  layout: PublicSite["sections"][number]["layout_type"];
  rootCell: PublicSite["sections"][number]["root_cell"];
  blocks: SiteBlock[];
  owner: SiteOwner;
}) {
  const byId = new Map(blocks.map((block) => [block.id, block]));

  if (layout === "bento") {
    const parsed = rootCell ? parseCell(rootCell) : null;
    // Prune to what this viewer actually received, so the layout closes up
    // around connections-only blocks instead of leaving holes that advertise
    // how much is being withheld.
    const pruned = parsed ? pruneCell(parsed, new Set(byId.keys())) : null;

    // `site-bento` is the containment context the root split queries against —
    // every deeper split queries the pane it sits in. See globals.css.
    if (pruned) {
      return (
        <div className="site-bento">
          <CellRender cell={pruned} blocks={byId} owner={owner} />
        </div>
      );
    }

    // A tree that failed to parse degrades to the stacked layout rather than
    // rendering nothing. The blocks are the content; the tree is only an opinion
    // about where they sit.
    return <StackedBlocks blocks={blocks} owner={owner} />;
  }

  if (layout === "row-scroll") {
    return (
      // `snap` plus a fixed basis, because a horizontal scroller whose children
      // size to content gives no clue that there is more to the right.
      <ul className="-mx-4 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 pb-2">
        {blocks.map((block) => (
          <li key={block.id} className="w-64 shrink-0 snap-start">
            <BlockRender block={block} owner={owner} />
          </li>
        ))}
      </ul>
    );
  }

  if (layout === "stack-scroll") {
    return (
      // The pile is plain `position: sticky` (globals.css) rather than a
      // scroll-driven animation — no `animation-timeline` support needed, and
      // under reduced motion it degrades to exactly `single`.
      <div className="site-stack">
        {blocks.map((block) => (
          <div key={block.id} className="site-stack-item">
            <BlockRender block={block} owner={owner} />
          </div>
        ))}
      </div>
    );
  }

  return <StackedBlocks blocks={blocks} owner={owner} />;
}

function StackedBlocks({
  blocks,
  owner,
}: {
  blocks: SiteBlock[];
  owner: SiteOwner;
}) {
  return (
    <div className="site-stack">
      {blocks.map((block) => (
        <BlockRender key={block.id} block={block} owner={owner} />
      ))}
    </div>
  );
}

/**
 * The recursive half, and the reason the tree needs no coordinates.
 *
 * Each split is a flex row or column; each PANE is a containment context. An
 * element cannot container-query itself, so the containment deliberately sits
 * one level down from the thing being measured: a split queries the pane it was
 * placed in, which is exactly the space it has to work with. A row that cannot
 * carry two children at that width becomes a column — independently, at every
 * depth. That is what lets one stored tree be correct on a 390px phone and on a
 * desktop with no second layout to maintain.
 *
 * `--ratio` is set on both children of a row split. It stops applying the moment
 * the container query flips the direction, because the stacked rule resets flex —
 * a ratio on a column would be setting heights, which clips text.
 */
function CellRender({
  cell,
  blocks,
  owner,
}: {
  cell: Cell;
  blocks: Map<string, SiteBlock>;
  owner: SiteOwner;
}) {
  if (cell.type === "component") {
    const block = blocks.get(cell.block_id);
    // pruneCell already removed unknown ids; this is the guard that makes the
    // renderer total rather than dependent on that having happened.
    if (!block) return null;
    return <BlockRender block={block} owner={owner} />;
  }

  const [first, second] = cell.children;

  return (
    <div className="cell-split" data-dir={cell.direction}>
      <div
        className="cell-pane"
        style={{ "--ratio": cell.ratio } as React.CSSProperties}
      >
        <CellRender cell={first} blocks={blocks} owner={owner} />
      </div>
      <div
        className="cell-pane"
        style={{ "--ratio": 1 - cell.ratio } as React.CSSProperties}
      >
        <CellRender cell={second} blocks={blocks} owner={owner} />
      </div>
    </div>
  );
}

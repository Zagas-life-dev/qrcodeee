"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { BLOCK_CATALOGUE, parseBlockContent } from "@/lib/site/blocks";
import { clampRatio, parseCell, type Cell, type CellPath } from "@/lib/site/cell";
import { renderOrder } from "@/lib/site/mutations";
import { useSiteStore } from "@/lib/site/store";
import { onAccent, parseTheme } from "@/lib/site/theme";
import type { OwnerSection } from "@/lib/site/owner";
import type { SiteBlock, SiteOwner } from "@/lib/site/read";
import type { SectionLayout } from "@/lib/supabase/database.types";
import { BlockRender } from "@/components/site/block-render";
import { ContactDetails } from "@/components/site/contact-details";
import { useReducedMotion } from "@/components/site/blocks/use-reduced-motion";

import { OnboardingStepper } from "./onboarding-stepper";
import { BlockSheet } from "./block-sheet";
import { EditorPanel, LAYOUTS, type PanelTab } from "./editor-panel";
import { EditorToolbar } from "./editor-toolbar";

/**
 * The site editor (site-spec S4).
 *
 * THE SHAPE, AND WHY IT CHANGED. This was one scrolling column carrying
 * everything: a publish card, a save indicator, the sections, a full theme
 * picker between them and the add-section grid, and — stapled inside every
 * single block — a visibility select, an alignment group, a tone group, a colour
 * well and a size slider. On a phone the page you were building was a minority
 * of the pixels; on a desktop the same column sat in the middle of an empty
 * screen. It is now three surfaces with three jobs:
 *
 *   TOOLBAR (editor-toolbar.tsx) — identity and page-wide state. Sticky, so
 *   "am I live" and "is my work saved" are answerable from anywhere in the page.
 *
 *   CANVAS (here) — the page itself, at the width it will actually be read at,
 *   plus the minimum chrome needed to tell blocks apart and pick one.
 *
 *   INSPECTOR (editor-panel.tsx) — everything that acts on a selection or on the
 *   whole page. A rail from `xl`, the same component in a sheet below that.
 *
 * WYSIWYG BY CONSTRUCTION: the previews use the SAME `site-bento` / `cell-split`
 * / `cell-pane` classes as the public renderer, so what the owner arranges is
 * what a visitor gets — including the container-query collapse, which is the
 * part most likely to surprise someone on a phone. The canvas column is capped
 * at the public page's own width for the same reason: an editor that lays out
 * wider than the page is an editor that lies about where things wrap.
 *
 * That is also why `react-resizable-panels` is not used here despite being in
 * the plan. It owns its own layout model, which would have to be kept in sync
 * with the Cell tree that is already the source of truth, and it renders its own
 * DOM — so the editor would stop matching the page it is editing. A pointer
 * handler writing a ratio is smaller, has no sync problem, and keeps the two
 * views identical.
 *
 * NOTHING HERE AWAITS THE SERVER, AND NOTHING HERE DISABLES ITSELF. Every
 * control calls `mutate`, which changes the draft synchronously and hands the
 * edit to the queue in store.tsx to deliver. The `disabled` attributes that used
 * to be on all of this were driven by one shared `pending` flag, so a single
 * slow request greyed out the entire page — including the controls that had
 * nothing to do with it. The remaining `disabled` props are about MEANING (the
 * first section cannot move up), never about being busy.
 */
export function SiteEditor({
  handle,
  publicUrl,
  owner,
  contact,
}: {
  handle: string;
  publicUrl: string;
  owner: SiteOwner;
  /**
   * The owner's own contact details, for the preview panel on the canvas.
   *
   * They are not editable here — /profile owns them — but they ARE part of the
   * page now (see contact-details.tsx), sitting between the identity and
   * everything below it. Leaving them out would mean the editor showed a page
   * with a hole in the middle of it.
   */
  contact: {
    phone: string | null;
    email: string | null;
    fields: { label: string; value: string | null }[];
  };
}) {
  const { site } = useSiteStore();
  const still = useReducedMotion();
  const theme = parseTheme(site.theme);

  /** The block whose CONTENT sheet is open. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The block the inspector is pointed at. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("add");
  const [panelOpen, setPanelOpen] = useState(false);

  /**
   * Whether to show the wizard, decided ONCE on mount.
   *
   * It cannot be a live `sections.length === 0`, which is what it was. The first
   * thing the wizard does is add a section — so the moment step one succeeded,
   * the condition it was mounted under went false and it unmounted itself,
   * taking steps two and three with it. That was survivable when a round trip
   * hid it; with an optimistic draft it happens in the same frame as the tap.
   *
   * It counts ORDINARY sections, not all of them. Every site now ships with the
   * pinned identity section, so `sections.length === 0` became a condition that
   * is never true and the wizard would have stopped appearing entirely.
   */
  const [onboarding, setOnboarding] = useState(
    () => site.sections.filter((section) => !section.pinned).length === 0,
  );

  // Resolved from the draft rather than held as a snapshot: the panel has to
  // show edits made to the same block while it is open, and a captured object
  // would show the block as it was when it was tapped.
  const blocks = site.sections.flatMap((section) => section.blocks);
  const editing = editingId ? (blocks.find((b) => b.id === editingId) ?? null) : null;
  const selected = selectedId ? (blocks.find((b) => b.id === selectedId) ?? null) : null;

  /**
   * The permanent identity section, and everything else.
   *
   * Split here rather than in the map, because the two get different chrome and
   * because the ordinary sections have to be numbered and moved among
   * THEMSELVES — "Section 1" is the first one the owner made, not the identity,
   * and its move-up button must be disabled rather than offering a swap the
   * server will refuse (see mutations.ts).
   *
   * `moveSection` still takes the index in the FULL list, since that is what the
   * server compares against; `pinnedOffset` converts between the two.
   */
  const pinned = site.sections.find((section) => section.pinned) ?? null;
  const ordinary = site.sections.filter((section) => !section.pinned);
  const pinnedOffset = pinned ? 1 : 0;

  // A block deleted from under the selection (or by another tab) leaves the
  // panel pointed at nothing. Falling back to the Add tab is what stops the
  // inspector rendering an empty frame with no way out of it.
  const panelTab: PanelTab = tab === "block" && !selected ? "add" : tab;

  /**
   * Read in the event handler, never during render.
   *
   * The rail and the sheet are the same panel at two widths, and only one of
   * them should react to a canvas control. Deciding that in render would mean a
   * `useSyncExternalStore` whose server snapshot is a guess — and a wrong guess
   * rearranges the editor on hydration. In a click handler the window is real
   * and the answer is exact.
   */
  const railVisible = () => window.matchMedia("(min-width: 80rem)").matches;

  const select = (blockId: string) => {
    setSelectedId(blockId);
    setTab("block");
    if (!railVisible()) setPanelOpen(true);
  };

  const openPanel = (next: "add" | "design") => {
    setTab(next);
    if (!railVisible()) setPanelOpen(true);
  };

  return (
    <>
      <EditorToolbar handle={handle} publicUrl={publicUrl} onOpenPanel={openPanel} />

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* THE CANVAS. Centred in whatever room is left rather than left-aligned:
            the thing being edited is a page, and a page has margins. */}
        <div className="min-w-0">
          {/* THE PAGE, IN THE OWNER'S OWN SKIN. The canvas carries the same
              `site-theme` attributes the public page does, so `sk-surface`,
              `sk-muted` and the rest resolve to the theme being edited rather
              than to nothing — which is what they did before, leaving every
              block on this screen drawn as an unstyled box. `site-theme-swatch`
              paints the page colour INSIDE this frame; the public page's
              `site-theme-page` paints it across the whole viewport, which here
              would repaint the app. */}
          <div
            className="site-theme site-theme-swatch mx-auto w-full max-w-xl space-y-5 rounded-brutal border-2 border-ink p-3 shadow-brutal sm:p-4"
            data-skin={theme.skin}
            data-font={theme.font}
            data-radius={theme.radius}
            data-density={theme.density}
            style={
              theme.accent
                ? ({
                    "--sk-accent": theme.accent,
                    "--sk-on-accent": onAccent(theme.accent),
                  } as React.CSSProperties)
                : undefined
            }
          >
            {onboarding ? <OnboardingStepper onDone={() => setOnboarding(false)} /> : null}

            {/* The identity, first and permanent. It is a real block in a real
                section — the app-drawn contact card that used to sit above
                everything on /u/{handle} is gone — so it is edited here like
                anything else, minus the controls that would remove it. */}
            {pinned ? (
              <PinnedSectionEditor
                owner={owner}
                section={pinned}
                selectedId={selectedId}
                onSelect={select}
                onEditContent={setEditingId}
              />
            ) : null}

            {/* Not editable from here — /profile owns these — but shown because
                this is where a visitor meets them. */}
            <CanvasNote label="Contact details · your connections only">
              <ContactDetails
                phone={contact.phone}
                email={contact.email}
                fields={contact.fields}
                showGaps
              />
            </CanvasNote>

            {ordinary.length === 0 && !onboarding ? (
              <div className="rounded-brutal border-2 border-dashed border-ink/50 bg-paper/80 px-4 py-8 text-center text-ink">
                <p className="text-sm font-semibold text-balance">
                  Nothing else on your page yet. Your profile and details above
                  are already live — sections go underneath them.
                </p>
                <button
                  type="button"
                  onClick={() => openPanel("add")}
                  className="mt-4 min-h-11 rounded-full border-2 border-ink bg-lilac px-4 text-sm font-semibold shadow-brutal nb-press"
                >
                  Add your first section
                </button>
              </div>
            ) : null}

            <AnimatePresence initial={false}>
              {ordinary.map((section, index) => (
                <motion.div
                  key={section.id}
                  layout={still ? false : "position"}
                  initial={still ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  // Collapsing the height on the way out is what stops the
                  // sections below snapping up before the deleted one has gone.
                  exit={still ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <SectionEditor
                    owner={owner}
                    section={section}
                    number={index + 1}
                    moveIndex={index + pinnedOffset}
                    canMoveUp={index > 0}
                    canMoveDown={index < ordinary.length - 1}
                    selectedId={selectedId}
                    onSelect={select}
                    onEditContent={setEditingId}
                    onAddBlock={() => {
                      setTargetSectionId(section.id);
                      openPanel("add");
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {ordinary.length > 0 ? (
              <button
                type="button"
                onClick={() => openPanel("add")}
                className="w-full rounded-brutal border-2 border-dashed border-ink/50 bg-paper/80 py-4 text-sm font-semibold text-ink nb-press-sm"
              >
                ＋ Add a section
              </button>
            ) : null}
          </div>
        </div>

        {/* THE RAIL. Rendered at every size and hidden with CSS below `xl`,
            rather than swapped in by a media-query hook — a hook reads `false`
            during server render, so a desktop first paint would show the sheet
            layout and rearrange itself on hydration. The sheet below is the
            same panel; only one of the two is reachable at any width. */}
        <div className="hidden xl:block">
          <div className="site-editor-rail overflow-hidden rounded-brutal border-2 border-ink bg-paper shadow-brutal">
            <EditorPanel
              tab={panelTab}
              onTab={setTab}
              selected={selected}
              sections={site.sections}
              targetSectionId={targetSectionId ?? selected?.section_id ?? null}
              onTargetSection={setTargetSectionId}
              onEditContent={setEditingId}
              onDeselect={() => setSelectedId(null)}
            />
          </div>
        </div>
      </div>

      <PanelSheet open={panelOpen} onClose={() => setPanelOpen(false)}>
        <EditorPanel
          tab={panelTab}
          onTab={setTab}
          selected={selected}
          sections={site.sections}
          targetSectionId={targetSectionId ?? selected?.section_id ?? null}
          onTargetSection={setTargetSectionId}
          onEditContent={(blockId) => {
            // The content sheet and the panel sheet are both modal dialogs, and
            // two open at once is a stack nobody can navigate back out of.
            setPanelOpen(false);
            setEditingId(blockId);
          }}
          onDeselect={() => setSelectedId(null)}
          onDone={() => setPanelOpen(false)}
        />
      </PanelSheet>

      <BlockSheet block={editing} owner={owner} onClose={() => setEditingId(null)} />
    </>
  );
}

/**
 * The inspector as a bottom sheet, for everything below `xl`.
 *
 * Same `<dialog>`/`nb-sheet` machinery as the content editor — focus trapping,
 * Escape and inertness from the platform rather than from a hand-rolled popover.
 *
 * THE RESIZE EFFECT IS NOT TIDINESS. `showModal()` makes the rest of the
 * document inert. If someone opens this on a narrow window and then widens it
 * past `xl`, the rail appears and the sheet is still modal over it — the page
 * would look interactive and refuse every click. Closing on the crossing is what
 * makes the two presentations mutually exclusive in fact and not just in CSS.
 */
function PanelSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) dialog.showModal();
    else dialog.close();

    // Cache Components keeps this route mounted when navigating away
    // (<Activity>), and a <dialog> holds its open state in the DOM rather than
    // in React — so without this the sheet is still open on return.
    return () => dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(min-width: 80rem)");
    if (query.matches) onClose();
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      className="nb-sheet"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="nb-grabber" />
      <div className="flex max-h-[78dvh] flex-col">{children}</div>
    </dialog>
  );
}

/**
 * A framed, labelled thing on the canvas that is NOT a section — the contact
 * details preview, and anything else the page shows but this screen doesn't own.
 *
 * The label is a paper pill rather than plain text because the canvas is now
 * painted in the owner's skin, and half of those skins are dark. Editor chrome
 * has to carry its own background or it disappears on `glass` and `maximal`.
 */
function CanvasNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-brutal border-2 border-dashed border-ink/50 p-2">
      <p className="mb-2 inline-block rounded-full border-2 border-ink bg-paper px-2 py-0.5 font-display text-[0.65rem] tracking-wide text-ink uppercase">
        {label}
      </p>
      {/* Inert: these values are edited on /profile, and a preview you can
          almost-but-not-quite type into is worse than one you plainly can't. */}
      <div className="pointer-events-none">{children}</div>
    </section>
  );
}

/**
 * The permanent identity section.
 *
 * Same block chrome as anywhere else, and deliberately none of the section
 * chrome: no layout picker (it holds one block), no move buttons (it is always
 * first), no delete (that is the whole point). What is left is a label saying so
 * and the block itself, which is fully editable — tagline, alignment, tone,
 * size. See the permanent identity migration for why the rules are in RLS rather
 * than only in this component.
 */
function PinnedSectionEditor({
  section,
  owner,
  selectedId,
  onSelect,
  onEditContent,
}: {
  section: OwnerSection;
  owner: SiteOwner;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  onEditContent: (blockId: string) => void;
}) {
  return (
    <section className="rounded-brutal border-2 border-dashed border-ink/50 p-2">
      <p className="mb-2 inline-block rounded-full border-2 border-ink bg-lilac px-2 py-0.5 font-display text-[0.65rem] tracking-wide text-ink uppercase">
        Your profile · always first
      </p>
      <div className="space-y-3">
        {section.blocks.map((block) => (
          <BlockChrome
            key={block.id}
            owner={owner}
            block={block}
            // One block, so there is nothing to trade places with and no move
            // buttons are drawn. The identity section holds exactly one block
            // and always will, which is why this needs no rule of its own.
            order={section.blocks.map((entry) => entry.id)}
            selected={block.id === selectedId}
            onSelect={onSelect}
            onEditContent={onEditContent}
          />
        ))}
      </div>
    </section>
  );
}

function SectionEditor({
  section,
  number,
  moveIndex,
  canMoveUp,
  canMoveDown,
  selectedId,
  onSelect,
  onEditContent,
  onAddBlock,
  owner,
}: {
  section: OwnerSection;
  /** Position among the ORDINARY sections — what the inspector's chips show. */
  number: number;
  /**
   * Position in the full list including the pinned identity, which is what
   * `moveSection` compares against on the server (see actions.ts).
   */
  moveIndex: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  owner: SiteOwner;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  onEditContent: (blockId: string) => void;
  onAddBlock: () => void;
}) {
  const { mutate } = useSiteStore();
  const still = useReducedMotion();

  const byId = new Map(section.blocks.map((block) => [block.id, block]));
  const tree = section.root_cell ? parseCell(section.root_cell) : null;

  /**
   * The order this section reads in, which is what its move buttons step
   * through. The shared rule rather than a local one: a bento's arrangement is
   * its tree and every other layout's is `sort_order`, and the server compares
   * the index a button sends against the same function.
   */
  const order = renderOrder(
    section.layout_type,
    tree,
    section.blocks.map((block) => block.id),
  );

  return (
    // Dashed outline, no fill: the canvas behind this is the page in the
    // owner's own skin now, and a solid editor-coloured panel would hide the
    // thing the canvas exists to show.
    <section className="rounded-brutal border-2 border-dashed border-ink/50 p-2">
      {/* The section's identity first, its controls second. "Section 2" is what
          the inspector's target chips refer to, so the number has to be visible
          somewhere. */}
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border-2 border-ink bg-paper px-2 py-0.5 font-display text-[0.65rem] tracking-wide text-ink uppercase">
          Section {number}
        </span>

        <select
          value={section.layout_type}
          onChange={(event) =>
            mutate({
              kind: "setSectionLayout",
              sectionId: section.id,
              layout: event.target.value as SectionLayout,
            })
          }
          aria-label={`Layout for section ${number}`}
          className="rounded-full border-2 border-ink bg-paper px-3 py-1 text-xs font-semibold text-ink shadow-brutal-sm"
        >
          {LAYOUTS.map((layout) => (
            <option key={layout.value} value={layout.value}>
              {layout.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label={`Move section ${number} up`}
            disabled={!canMoveUp}
            onClick={() =>
              mutate({
                kind: "moveSection",
                sectionId: section.id,
                direction: "up",
                fromIndex: moveIndex,
              })
            }
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move section ${number} down`}
            disabled={!canMoveDown}
            onClick={() =>
              mutate({
                kind: "moveSection",
                sectionId: section.id,
                direction: "down",
                fromIndex: moveIndex,
              })
            }
          >
            ↓
          </IconButton>
          <IconButton
            label={`Delete section ${number}`}
            onClick={() => {
              if (confirm("Delete this section and everything in it?")) {
                mutate({ kind: "deleteSection", sectionId: section.id });
              }
            }}
          >
            ✕
          </IconButton>
        </div>
      </header>

      <div className="mt-3">
        {section.blocks.length === 0 ? (
          <button
            type="button"
            onClick={onAddBlock}
            className="w-full rounded-brutal border-2 border-dashed border-ink/40 bg-paper/80 p-6 text-center text-sm font-semibold text-ink"
          >
            Empty — add a block
          </button>
        ) : section.layout_type === "bento" && tree ? (
          <div className="site-bento">
            <EditorCell
              owner={owner}
              cell={tree}
              path={[]}
              sectionId={section.id}
              blocks={byId}
              order={order}
              selectedId={selectedId}
              onSelect={onSelect}
              onEditContent={onEditContent}
            />
          </div>
        ) : (
          /* Only the stacked layouts get enter/exit animation. A bento's blocks
             live inside nested split cells, so they are not children
             AnimatePresence can track — and the honest alternative, animating
             the tree itself, would move panes that did not change. */
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {section.blocks.map((block) => (
                <motion.div
                  key={block.id}
                  layout={still ? false : "position"}
                  initial={still ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <BlockChrome
                    owner={owner}
                    block={block}
                    order={order}
                    selected={block.id === selectedId}
                    onSelect={onSelect}
                    onEditContent={onEditContent}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {section.blocks.length > 0 ? (
        <button
          type="button"
          onClick={onAddBlock}
          className="mt-3 min-h-9 w-full rounded-full border-2 border-ink bg-paper text-xs font-semibold text-ink shadow-brutal-sm nb-press-sm"
        >
          ＋ Add a block here
        </button>
      ) : null}
    </section>
  );
}

function EditorCell({
  cell,
  path,
  sectionId,
  blocks,
  order,
  selectedId,
  onSelect,
  onEditContent,
  owner,
}: {
  cell: Cell;
  path: CellPath;
  sectionId: string;
  owner: SiteOwner;
  blocks: Map<string, SiteBlock>;
  /** The section's reading order — its leaves, here. See SectionEditor. */
  order: readonly string[];
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  onEditContent: (blockId: string) => void;
}) {
  const { mutate } = useSiteStore();
  const splitRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  if (cell.type === "component") {
    const block = blocks.get(cell.block_id);
    if (!block) return null;
    return (
      <BlockChrome
        owner={owner}
        block={block}
        order={order}
        selected={block.id === selectedId}
        onSelect={onSelect}
        onEditContent={onEditContent}
      />
    );
  }

  const ratio = dragRatio ?? cell.ratio;

  /**
   * Resize, for row splits only.
   *
   * A ratio on a column split would be setting HEIGHTS, which clips text — so
   * there is deliberately no handle there, matching what the renderer honours.
   *
   * Pointer events rather than mouse/touch pairs: one code path covers finger,
   * stylus and mouse, and `setPointerCapture` keeps the drag alive when the
   * finger slides outside the narrow handle, which on a phone is most of the
   * time.
   *
   * The drag was already local-then-commit, which is what the whole editor now
   * does — this is the pattern the rest of the page was rebuilt around.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = splitRef.current;
    if (!element) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const rect = element.getBoundingClientRect();
    const move = (clientX: number) =>
      setDragRatio(clampRatio((clientX - rect.left) / rect.width));

    move(event.clientX);

    const onMove = (moveEvent: PointerEvent) => move(moveEvent.clientX);
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const next = clampRatio((upEvent.clientX - rect.left) / rect.width);
      setDragRatio(null);
      if (next !== cell.ratio) mutate({ kind: "setSplitRatio", sectionId, path, ratio: next });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={splitRef}
      className="cell-split editor-split"
      data-dir={cell.direction}
      style={{ "--ratio": ratio } as React.CSSProperties}
    >
      <div className="cell-pane" style={{ "--ratio": ratio } as React.CSSProperties}>
        <EditorCell
          owner={owner}
          cell={cell.children[0]}
          path={[...path, 0]}
          sectionId={sectionId}
          blocks={blocks}
          order={order}
          selectedId={selectedId}
          onSelect={onSelect}
          onEditContent={onEditContent}
        />
      </div>

      {cell.direction === "row" ? (
        <div
          role="separator"
          aria-label="Resize panes"
          aria-orientation="vertical"
          className="editor-resize"
          onPointerDown={onPointerDown}
        />
      ) : null}

      <div className="cell-pane" style={{ "--ratio": 1 - ratio } as React.CSSProperties}>
        <EditorCell
          owner={owner}
          cell={cell.children[1]}
          path={[...path, 1]}
          sectionId={sectionId}
          blocks={blocks}
          order={order}
          selectedId={selectedId}
          onSelect={onSelect}
          onEditContent={onEditContent}
        />
      </div>
    </div>
  );
}

/**
 * A block on the canvas: what it is, where it sits, and two ways in.
 *
 * WHAT IT NO LONGER CARRIES. Visibility, alignment, tone, colour, size and the
 * two split buttons all used to be here, on every block, whether or not it was
 * the one being worked on — five controls of chrome around one block of content.
 * They live in the inspector now, pointed at whatever is selected, so a section
 * of four blocks shows four blocks rather than twenty-four controls.
 *
 * MOVING IS THE EXCEPTION THAT STAYS ON THE CANVAS. Reordering is spatial: you
 * are choosing a position by looking at the positions, so the control has to be
 * on the thing being moved and the result has to be visible the moment it
 * happens. In the inspector it would be a button on a rail — and below `xl`, a
 * button inside a sheet covering the very page it was rearranging.
 *
 * The PREVIEW ITSELF SELECTS, which is what makes that trade work: the block you
 * want to change is the thing you point at. Its contents are
 * `pointer-events-none` — a links block renders real anchors, and in an editor a
 * tap on one has to mean "select this block", not "leave the page".
 */
function BlockChrome({
  block,
  order,
  selected,
  onSelect,
  onEditContent,
  owner,
}: {
  block: SiteBlock;
  /**
   * Every block in this section, in the order the section reads — see
   * `renderOrder`. A single-entry list means there is nothing to trade places
   * with, and the move buttons are not drawn at all.
   */
  order: readonly string[];
  selected: boolean;
  owner: SiteOwner;
  onSelect: (blockId: string) => void;
  onEditContent: (blockId: string) => void;
}) {
  const { mutate } = useSiteStore();
  const index = order.indexOf(block.id);
  // Parsed here rather than trusting the row, so an empty or corrupt block gets
  // a placeholder its owner can actually tap instead of rendering as nothing —
  // which is exactly what the public page does with it, and would be
  // indistinguishable from a bug in the editor.
  const renderable = parseBlockContent(block.type, block.content) !== null;

  const label =
    BLOCK_CATALOGUE.find((entry) => entry.type === block.type)?.label ?? block.type;

  return (
    // SELECTION IS A RING, NOT A FILL, and the canvas skin is why. This box sits
    // directly on the page being edited, so a lilac fill would tint the block
    // inside it and the owner would be judging their own colours through it. A
    // ring marks the same thing and touches nothing.
    <div
      className={`h-full rounded-brutal p-2 transition-shadow duration-[--dur-fast] ${
        selected ? "ring-4 ring-lilac" : ""
      }`}
    >
      {/* Wraps, because a bento pane can be a third of a phone's width and this
          row now carries up to four controls. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Every label on the canvas carries its own paper fill: half the skins
            are dark, and unfilled ink text vanishes on `glass` or `maximal`. */}
        <span className="min-w-0 truncate rounded-full border-2 border-ink bg-paper px-2 py-0.5 font-display text-[0.65rem] tracking-wide text-ink uppercase">
          {label}
        </span>

        {/* Visibility is a status here and a control in the inspector. Shown
            only when it is not the default, because "Everyone" on every block
            is a badge that says nothing. */}
        {block.visibility !== "public" ? (
          <span className="shrink-0 rounded-full border-2 border-ink bg-lemon px-2 py-0.5 text-[0.65rem] font-semibold text-ink">
            {block.visibility === "private" ? "Only me" : "Connections"}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {/* "EARLIER" AND "LATER" RATHER THAN "UP" AND "DOWN", because the
              axis is the section's business and not this button's. A stacked
              section moves a block up the page, a carousel moves it left along
              the swipe, and a bento moves it to the pane before this one —
              which may be beside it on a desktop and above it once the
              container query stacks them. Reading order is the one description
              that is true in all four, and the arrow is the list-reordering
              convention for "toward the start". */}
          {order.length > 1 ? (
            <>
              <IconButton
                label={`Move ${label} earlier`}
                disabled={index <= 0}
                onClick={() =>
                  mutate({
                    kind: "moveBlock",
                    blockId: block.id,
                    direction: "up",
                    fromIndex: index,
                  })
                }
              >
                ↑
              </IconButton>
              <IconButton
                label={`Move ${label} later`}
                disabled={index === -1 || index >= order.length - 1}
                onClick={() =>
                  mutate({
                    kind: "moveBlock",
                    blockId: block.id,
                    direction: "down",
                    fromIndex: index,
                  })
                }
              >
                ↓
              </IconButton>
            </>
          ) : null}

          <IconButton label={`Edit ${label} content`} onClick={() => onEditContent(block.id)}>
            ✎
          </IconButton>
          {/* The keyboard and screen-reader path to selection. The preview
              overlay below does the same job for a pointer, and is hidden from
              assistive tech precisely so it doesn't announce twice. */}
          <IconButton
            label={`${label} settings`}
            pressed={selected}
            onClick={() => onSelect(block.id)}
          >
            ⚙
          </IconButton>
        </div>
      </div>

      <div className="mt-2">
        {renderable ? (
          <div className="relative">
            <div className="pointer-events-none">
              <BlockRender block={block} owner={owner} />
            </div>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => onSelect(block.id)}
              className="absolute inset-0 cursor-pointer rounded-brutal"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onEditContent(block.id)}
            className="w-full rounded-brutal border-2 border-dashed border-ink/40 bg-paper/80 p-4 text-center text-xs font-semibold text-ink"
          >
            Empty — tap to add content
          </button>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Set only on toggles — a plain action button must not claim a state. */
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      // `text-ink` explicitly: these sit on the skinned canvas, which sets its
      // own `color`, and an inherited paper-on-paper glyph is an invisible one.
      className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xs font-semibold text-ink shadow-brutal-sm nb-press-sm disabled:opacity-40 ${
        pressed ? "bg-lilac" : "bg-paper"
      }`}
    >
      {children}
    </button>
  );
}

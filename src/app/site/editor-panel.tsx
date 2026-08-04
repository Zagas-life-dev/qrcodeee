"use client";

import { BLOCK_CATALOGUE, isBlockType } from "@/lib/site/blocks";
import { newId } from "@/lib/site/mutations";
import { useSiteStore } from "@/lib/site/store";
import { parseTheme } from "@/lib/site/theme";
import type { OwnerSection } from "@/lib/site/owner";
import type { SiteBlock } from "@/lib/site/read";
import type { BlockVisibility, SectionLayout } from "@/lib/supabase/database.types";

import { BlockStyleControls } from "./block-style-controls";
import { ThemeControls } from "./theme-picker";

export type PanelTab = "block" | "add" | "design";

export const LAYOUTS: { value: SectionLayout; label: string; hint: string }[] = [
  { value: "single", label: "Stacked", hint: "One block after another." },
  { value: "bento", label: "Bento", hint: "Split the space into panes." },
  { value: "row-scroll", label: "Carousel", hint: "Swipe sideways." },
  { value: "stack-scroll", label: "Pile", hint: "Cards stack as you scroll." },
];

const VISIBILITY: { value: BlockVisibility; label: string; hint: string }[] = [
  { value: "public", label: "Everyone", hint: "Anyone who opens your link." },
  { value: "connections", label: "Connections", hint: "Only people you've met." },
  { value: "private", label: "Only me", hint: "Nobody else sees it." },
];

/**
 * The inspector: everything that ACTS on the page, gathered off the canvas.
 *
 * THE PROBLEM IT SOLVES. Every control used to live inline in one scrolling
 * column — a row of alignment, tone and size controls stapled under each block's
 * header, eight "+ Block" pills at the foot of every section, the whole theme
 * picker sitting between the sections and the button that adds another one. The
 * page you were building was outnumbered by the controls building it, and none
 * of them were in the same place twice.
 *
 * So the split is by ROLE, not by feature: the canvas shows the page and the
 * chrome needed to identify a block, and everything else — what a block looks
 * like, who can see it, what to add next, how the whole page is skinned — is
 * here. On a wide display this is a rail beside the canvas; below `xl` it is the
 * same component inside a sheet.
 *
 * SELECTION DRIVES IT. Tapping a block opens its tab, which is the interaction
 * anyone who has used a design tool already knows, and it is what lets a block's
 * own chrome shrink to a label and two buttons.
 */
export function EditorPanel({
  tab,
  onTab,
  selected,
  sections,
  targetSectionId,
  onTargetSection,
  onEditContent,
  onDeselect,
  onDone,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  selected: SiteBlock | null;
  sections: OwnerSection[];
  /** Which section "add a block" adds to. */
  targetSectionId: string | null;
  onTargetSection: (sectionId: string) => void;
  onEditContent: (blockId: string) => void;
  onDeselect: () => void;
  /** Present only in the sheet, where the panel needs a way to be dismissed. */
  onDone?: () => void;
}) {
  const { site } = useSiteStore();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b-2 border-ink px-3 py-2.5">
        {/* A pressed-button group rather than `role="tablist"`. Real tabs owe
            the reader `aria-controls` pointing at a `role="tabpanel"` and arrow
            key navigation; half of that contract is worse than none, and what
            this actually is — three mutually exclusive toggles — has an honest
            role already. */}
        <div
          role="group"
          aria-label="Editor panel"
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {selected ? (
            <Tab id="block" tab={tab} onTab={onTab}>
              Block
            </Tab>
          ) : null}
          <Tab id="add" tab={tab} onTab={onTab}>
            Add
          </Tab>
          <Tab id="design" tab={tab} onTab={onTab}>
            Design
          </Tab>
        </div>

        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="min-h-9 shrink-0 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
          >
            Done
          </button>
        ) : null}
      </div>

      {/* The scroller is the panel body, never the page: in the rail this is a
          fixed-height column beside a canvas that scrolls on its own, and in the
          sheet it is a fixed-height sheet. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "block" && selected ? (
          <BlockPanel
            block={selected}
            sections={sections}
            onEditContent={onEditContent}
            onDeselect={onDeselect}
          />
        ) : null}

        {tab === "add" ? (
          <AddPanel
            sections={sections}
            targetSectionId={targetSectionId}
            onTargetSection={onTargetSection}
          />
        ) : null}

        {tab === "design" ? <ThemeControls theme={parseTheme(site.theme)} /> : null}
      </div>
    </div>
  );
}

function Tab({
  id,
  tab,
  onTab,
  children,
}: {
  id: PanelTab;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  children: React.ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onTab(id)}
      className={`min-h-9 rounded-full border-2 border-ink px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
        active ? "bg-lilac" : "bg-paper"
      }`}
    >
      {children}
    </button>
  );
}

/** Everything about the one block you have selected. */
function BlockPanel({
  block,
  sections,
  onEditContent,
  onDeselect,
}: {
  block: SiteBlock;
  sections: OwnerSection[];
  onEditContent: (blockId: string) => void;
  onDeselect: () => void;
}) {
  const { mutate } = useSiteStore();

  const label =
    BLOCK_CATALOGUE.find((entry) => entry.type === block.type)?.label ?? block.type;

  const section = sections.find((entry) => entry.id === block.section_id);

  /**
   * The permanent identity block.
   *
   * Its content and its styling are editable like anything else; what it does
   * not get is the three controls that would take it off the page — visibility,
   * split, delete. Those are refused by RLS and by `applyMutation` too (see the
   * permanent identity migration); this is just the half of it the owner sees,
   * and offering a button whose only outcome is a refusal is worse than not
   * offering it.
   */
  const permanent = section?.pinned === true;

  // Splitting only means something inside a bento — it writes a new leaf into
  // that section's cell tree, and the other three layouts have no tree to write
  // into. Offering it everywhere was offering two buttons that silently did
  // something different from what they said.
  const inBento = section?.layout_type === "bento";

  // `isBlockType` rather than a cast because `type` is a text column that
  // degrades on purpose (see the schema) — a row written by a newer deploy
  // reaches here as a string this build has no starter content for, and offering
  // a button that mints an unknown block would queue an edit the server can only
  // refuse.
  const splittable = isBlockType(block.type);

  const split = (direction: "row" | "col") => {
    if (!isBlockType(block.type)) return;
    mutate({
      kind: "addBlock",
      sectionId: block.section_id,
      blockId: newId(),
      type: block.type,
      splitFrom: { blockId: block.id, direction },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border-2 border-ink bg-sky px-2.5 py-0.5 font-display text-xs tracking-wide uppercase">
          {label}
        </span>
        {permanent ? (
          <span className="rounded-full border-2 border-ink bg-lilac px-2.5 py-0.5 text-xs font-semibold">
            Always on your page
          </span>
        ) : null}
        <button
          type="button"
          onClick={onDeselect}
          className="ml-auto text-xs font-semibold underline"
        >
          Deselect
        </button>
      </div>

      {permanent ? (
        <p className="rounded-brutal border-2 border-ink bg-paper p-3 text-xs font-medium shadow-brutal-sm">
          This is the top of your page — your name, photo and handle, read live
          from your profile. Edit those on{" "}
          <span className="font-semibold">Profile</span>; the tagline and the
          styling are here.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => onEditContent(block.id)}
        className="w-full min-h-11 rounded-full border-2 border-ink bg-lilac px-4 text-sm font-semibold shadow-brutal nb-press"
      >
        Edit content
      </button>

      {!permanent ? (
        <Group title="Who can see it">
          <div className="space-y-1.5">
            {VISIBILITY.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={block.visibility === option.value}
                onClick={() =>
                  mutate({
                    kind: "setBlockVisibility",
                    blockId: block.id,
                    visibility: option.value,
                  })
                }
                className={`block w-full rounded-brutal border-2 border-ink px-3 py-2 text-left shadow-brutal-sm nb-press-sm ${
                  block.visibility === option.value ? "bg-lilac" : "bg-paper"
                }`}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="block text-xs font-medium">{option.hint}</span>
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title="Look">
        <BlockStyleControls block={block} />
      </Group>

      {!permanent && inBento && splittable ? (
        <Group title="Split this pane">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => split("row")}
              className="min-h-9 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
            >
              ⬌ Beside
            </button>
            <button
              type="button"
              onClick={() => split("col")}
              className="min-h-9 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
            >
              ⬍ Below
            </button>
          </div>
          <p className="mt-2 text-xs font-medium text-ink/70">
            Adds another {label.toLowerCase()} block sharing this space. Drag the
            handle between panes to change the balance.
          </p>
        </Group>
      ) : null}

      {!permanent ? (
        <button
          type="button"
          onClick={() => {
            mutate({ kind: "deleteBlock", blockId: block.id });
            onDeselect();
          }}
          className="w-full min-h-11 rounded-full border-2 border-ink bg-coral px-4 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          Delete block
        </button>
      ) : null}
    </div>
  );
}

/** The catalogue, and the one decision it needs: which section it lands in. */
function AddPanel({
  sections: all,
  targetSectionId,
  onTargetSection,
}: {
  sections: OwnerSection[];
  targetSectionId: string | null;
  onTargetSection: (sectionId: string) => void;
}) {
  const { mutate } = useSiteStore();

  // The permanent identity section is not a container the owner fills — it holds
  // its one block and the INSERT policy refuses any more. Excluded here so it is
  // never offered as a destination, and so the numbering below matches the
  // canvas, where the ordinary sections are the ones counted.
  const sections = all.filter((section) => !section.pinned);
  const target = sections.find((section) => section.id === targetSectionId) ?? sections.at(-1);

  return (
    <div className="space-y-6">
      <Group title="Add a block">
        {sections.length === 0 ? (
          <p className="rounded-brutal border-2 border-dashed border-ink/40 p-3 text-sm font-medium">
            Add a section first — a block has to live in one.
          </p>
        ) : (
          <>
            {/* Only asked when there is a choice to make. One section means the
                answer is never in doubt, and a single-option control is a
                question the interface already knows the answer to. */}
            {sections.length > 1 ? (
              <div className="mb-3">
                <p className="text-xs font-semibold">Into which section?</p>
                <div
                  role="group"
                  aria-label="Target section"
                  className="mt-1.5 flex flex-wrap gap-1.5"
                >
                  {sections.map((section, index) => (
                    <button
                      key={section.id}
                      type="button"
                      aria-pressed={section.id === target?.id}
                      onClick={() => onTargetSection(section.id)}
                      className={`min-h-9 rounded-full border-2 border-ink px-3 text-xs font-semibold shadow-brutal-sm nb-press-sm ${
                        section.id === target?.id ? "bg-lilac" : "bg-paper"
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <ul className="grid grid-cols-2 gap-2">
              {BLOCK_CATALOGUE.map((entry) => (
                <li key={entry.type}>
                  <button
                    type="button"
                    disabled={!target}
                    onClick={() =>
                      target &&
                      mutate({
                        kind: "addBlock",
                        sectionId: target.id,
                        blockId: newId(),
                        type: entry.type,
                      })
                    }
                    className="w-full min-h-11 rounded-brutal border-2 border-ink bg-paper px-3 text-sm font-semibold shadow-brutal-sm nb-press-sm disabled:opacity-40"
                  >
                    ＋ {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Group>

      <Group
        title="Add a section"
        hint="A section is one band across your page. Its layout decides how the blocks inside it sit together."
      >
        <ul className="grid gap-2">
          {LAYOUTS.map((layout) => (
            <li key={layout.value}>
              <button
                type="button"
                onClick={() => {
                  const sectionId = newId();
                  mutate({ kind: "addSection", sectionId, layout: layout.value });
                  // Adding a section is nearly always followed by filling it, so
                  // the catalogue above should already be pointed at the new one.
                  onTargetSection(sectionId);
                }}
                className="w-full rounded-brutal border-2 border-ink bg-paper p-3 text-left shadow-brutal-sm nb-press-sm"
              >
                <span className="block font-display text-sm">{layout.label}</span>
                <span className="mt-0.5 block text-xs font-medium">{layout.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-display text-sm">{title}</h3>
      {hint ? <p className="mt-1 text-xs font-medium text-ink/70">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

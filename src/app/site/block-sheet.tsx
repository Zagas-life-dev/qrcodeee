"use client";

import { useEffect, useRef, useState } from "react";

import { useSiteStore } from "@/lib/site/store";
import {
  MAX_GALLERY_IMAGES,
  MAX_LINKS,
  MAX_LIST_ITEMS,
  MAX_SOCIALS,
  MAX_STATS,
  SOCIAL_NETWORKS,
  parseBlockContent,
  richDocToText,
  textToRichDoc,
  type SocialNetwork,
  type SocialVariant,
} from "@/lib/site/blocks";
import { SocialIcon } from "@/lib/site/social-icons";
import type { ImageRef } from "@/lib/site/blocks";
import type { SiteBlock, SiteOwner } from "@/lib/site/read";

import { ImageField } from "./image-field";

/**
 * The per-block content editor, as a bottom sheet.
 *
 * One sheet for every block type rather than one each: they share the
 * open/close plumbing, the save transition and the error handling, and only the
 * middle differs. `<dialog>` gives focus trapping, Escape and inertness from the
 * platform — see the `nb-sheet` note in globals.css.
 *
 * SAVE CLOSES THE SHEET IMMEDIATELY, and there is no "Saved" toast any more.
 * The edit is applied to the draft before this returns, so closing reveals the
 * block already showing the new content — which says "saved" more convincingly
 * than a toast, and without the second of "Saving…" that used to sit between
 * the tap and the result. If the write is later refused, the sheet is long gone
 * and the message arrives on its own; that is the right trade for an editor
 * where the overwhelming majority of saves succeed.
 */
export function BlockSheet({
  block,
  onClose,
  owner,
}: {
  block: SiteBlock | null;
  onClose: () => void;
  owner: SiteOwner;
}) {
  const { mutate } = useSiteStore();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (block) dialog.showModal();
    else dialog.close();

    // Cache Components keeps this route mounted when navigating away
    // (<Activity>), and a <dialog> holds its open state in the DOM rather than
    // in React — so without this the sheet is still open on return.
    return () => dialog.close();
  }, [block]);

  const save = (content: unknown) => {
    if (!block) return;
    mutate({ kind: "saveBlockContent", blockId: block.id, content });
    onClose();
  };

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
      <div className="max-h-[75dvh] overflow-y-auto p-5">
        {block ? (
          <BlockForm
            block={block}
            owner={owner}
            onSave={save}
            onCancel={onClose}
          />
        ) : null}
      </div>
    </dialog>
  );
}

function BlockForm({
  block,
  owner,
  onSave,
  onCancel,
}: {
  block: SiteBlock;
  owner: SiteOwner;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const parsed = parseBlockContent(block.type, block.content);

  if (block.type === "text") {
    return (
      <TextForm
        initial={parsed?.type === "text" ? richDocToText(parsed.content.doc) : ""}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "links") {
    return (
      <LinksForm
        initial={parsed?.type === "links" ? parsed.content.items : []}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "socials") {
    return (
      <SocialsForm
        initialVariant={parsed?.type === "socials" ? parsed.content.variant : "chips"}
        initial={parsed?.type === "socials" ? parsed.content.items : []}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "image") {
    return (
      <ImageForm
        initial={parsed?.type === "image" ? parsed.content : null}
        owner={owner}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "gallery") {
    return (
      <GalleryForm
        initial={parsed?.type === "gallery" ? parsed.content.items : []}
        owner={owner}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "stats") {
    return (
      <StatsForm
        initial={parsed?.type === "stats" ? parsed.content.items : []}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "list") {
    return (
      <ListForm
        initial={parsed?.type === "list" ? parsed.content.items : []}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (block.type === "identity") {
    return (
      <IdentityForm
        initial={parsed?.type === "identity" ? parsed.content.tagline : null}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  return <p className="text-sm font-medium">This block can&apos;t be edited here yet.</p>;
}

function Footer({
  onCancel,
  disabled,
}: {
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 flex gap-2 pb-2">
      <button
        type="submit"
        disabled={disabled}
        className="flex-1 rounded-full border-2 border-ink bg-lilac px-4 py-3 text-sm font-semibold shadow-brutal nb-press disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border-2 border-ink bg-paper px-4 py-3 text-sm font-semibold shadow-brutal nb-press"
      >
        Cancel
      </button>
    </div>
  );
}

const FIELD =
  "w-full rounded-brutal border-2 border-ink bg-paper px-3 py-2.5 text-base font-medium shadow-brutal-sm sm:text-sm";

function TextForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const doc = textToRichDoc(text);
        if (!doc) return;
        onSave({ doc });
      }}
    >
      <h2 className="font-display text-lg">Text</h2>
      {/* A textarea rather than a rich-text surface, deliberately — see the
          note above textToRichDoc. The conventions are stated here because
          nothing else in the UI would reveal them. */}
      <p className="mt-2 text-xs font-medium text-ink/70">
        Start a line with <code className="font-mono">##</code> for a heading,{" "}
        <code className="font-mono">###</code> for a smaller one, or{" "}
        <code className="font-mono">-</code> for a bullet. Links starting with
        https:// become clickable.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        autoFocus
        className={`mt-3 ${FIELD}`}
      />
      <Footer onCancel={onCancel} disabled={text.trim().length === 0} />
    </form>
  );
}

function LinksForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { label: string; url: string }[];
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(
    initial.length > 0 ? initial : [{ label: "", url: "" }],
  );

  const update = (index: number, patch: Partial<{ label: string; url: string }>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // Empty rows are dropped rather than rejected: someone who added a row
        // and changed their mind should be able to save, not hunt for the row.
        onSave({ items: items.filter((item) => item.url.trim().length > 0) });
      }}
    >
      <h2 className="font-display text-lg">Links</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Links must start with <code className="font-mono">https://</code>.
      </p>

      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="space-y-2 rounded-brutal border-2 border-ink bg-canvas p-3"
          >
            <input
              value={item.label}
              onChange={(event) => update(index, { label: event.target.value })}
              placeholder="Label"
              maxLength={80}
              className={FIELD}
            />
            <input
              value={item.url}
              onChange={(event) => update(index, { url: event.target.value })}
              placeholder="https://example.com"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              className="text-xs font-semibold underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {items.length < MAX_LINKS ? (
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { label: "", url: "" }])}
          className="mt-3 rounded-full border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          Add another
        </button>
      ) : null}

      <Footer onCancel={onCancel} />
    </form>
  );
}

function SocialsForm({
  initial,
  initialVariant,
  onSave,
  onCancel,
}: {
  initial: { network: SocialNetwork; handle: string }[];
  initialVariant: SocialVariant;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(
    initial.length > 0 ? initial : [{ network: "instagram" as SocialNetwork, handle: "" }],
  );

  // At most one network grid is open at a time. A `<select>` collapsed to one
  // line for each of twelve rows; twelve permanently-expanded logo grids would
  // be 144 tiles in a bottom sheet, which is not a picker, it is a wall. One
  // open at a time keeps the sheet the same height it was.
  const [picking, setPicking] = useState<number | null>(null);
  const [variant, setVariant] = useState<SocialVariant>(initialVariant);

  const update = (
    index: number,
    patch: Partial<{ network: SocialNetwork; handle: string }>,
  ) => setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          items: items.filter((item) => item.handle.trim().length > 0),
          variant,
        });
      }}
    >
      <h2 className="font-display text-lg">Social links</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Just the handle — we build the link. A leading @ is fine.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Display">
        {(
          [
            ["chips", "Name + icon"],
            ["dock", "Icons only"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={variant === value}
            onClick={() => setVariant(value)}
            className={`min-h-11 rounded-full border-2 border-ink px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
              variant === value ? "bg-lilac" : "bg-paper"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="space-y-2 rounded-brutal border-2 border-ink bg-canvas p-3"
          >
            {/* A `<select>` cannot draw a logo in an option — the browser owns
                that list and paints it as text. So the trigger shows the chosen
                mark, and the choices are a grid of marks. */}
            <button
              type="button"
              onClick={() => setPicking((open) => (open === index ? null : index))}
              aria-expanded={picking === index}
              aria-controls={`network-grid-${index}`}
              className={`${FIELD} flex items-center gap-2 text-left`}
            >
              <SocialIcon network={item.network} className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {SOCIAL_NETWORKS[item.network].label}
              </span>
              <span aria-hidden className="shrink-0 text-ink/70">
                {picking === index ? "▴" : "▾"}
              </span>
            </button>

            {picking === index ? (
              /* Native radios, visually hidden behind their labels. That buys
                 arrow-key navigation, the single-tab-stop group, and the
                 checked state announcement from the platform — all of which
                 would otherwise be a roving-tabindex implementation to write
                 and then get wrong. */
              <fieldset id={`network-grid-${index}`} className="mt-2">
                <legend className="sr-only">Network</legend>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {Object.entries(SOCIAL_NETWORKS).map(([key, network]) => {
                    const value = key as SocialNetwork;
                    const active = item.network === value;
                    return (
                      <label
                        key={key}
                        title={network.label}
                        className={`flex min-h-11 cursor-pointer items-center justify-center rounded-brutal border-2 border-ink p-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink ${
                          active ? "bg-lilac shadow-brutal-sm" : "bg-paper"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`network-${index}`}
                          value={value}
                          checked={active}
                          onChange={() => {
                            update(index, { network: value });
                            setPicking(null);
                          }}
                          className="sr-only"
                        />
                        <SocialIcon network={value} className="size-5" />
                        <span className="sr-only">{network.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            <input
              value={item.handle}
              onChange={(event) => update(index, { handle: event.target.value })}
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              className="text-xs font-semibold underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {items.length < MAX_SOCIALS ? (
        <button
          type="button"
          onClick={() =>
            setItems((prev) => [...prev, { network: "instagram", handle: "" }])
          }
          className="mt-3 rounded-full border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          Add another
        </button>
      ) : null}

      <Footer onCancel={onCancel} />
    </form>
  );
}

function ImageForm({
  initial,
  owner,
  onSave,
  onCancel,
}: {
  initial: { image: ImageRef; caption: string | null } | null;
  owner: SiteOwner;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [image, setImage] = useState<ImageRef | null>(initial?.image ?? null);
  const [caption, setCaption] = useState(initial?.caption ?? "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!image) return;
        onSave({ image, caption: caption.trim() || null });
      }}
    >
      <h2 className="font-display text-lg">Image</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Anyone who opens your page can see this.
      </p>

      <div className="mt-3 space-y-3">
        <ImageField
          value={image}
          owner={owner}
          onChange={setImage}
          onRemove={() => setImage(null)}
        />

        <label className="block">
          <span className="block text-xs font-semibold">Caption (optional)</span>
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Shown under the image"
            className={`mt-1 ${FIELD}`}
          />
        </label>
      </div>

      {/* Saving with no image would store `{}` and render the block as nothing,
          which reads as the save having failed. */}
      <Footer onCancel={onCancel} disabled={!image} />
    </form>
  );
}

function GalleryForm({
  initial,
  owner,
  onSave,
  onCancel,
}: {
  initial: ImageRef[];
  owner: SiteOwner;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<ImageRef[]>(initial);

  const replace = (index: number, ref: ImageRef) =>
    setItems((prev) => prev.map((item, i) => (i === index ? ref : item)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ items });
      }}
    >
      <h2 className="font-display text-lg">Gallery</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Up to {MAX_GALLERY_IMAGES} images. They tile to fill the space they are
        given.
      </p>

      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li key={item.id}>
            <ImageField
              value={item}
              owner={owner}
              label="replacement"
              onChange={(ref) => replace(index, ref)}
              onRemove={() => setItems((prev) => prev.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>

      {items.length < MAX_GALLERY_IMAGES ? (
        <div className="mt-3">
          {/* A field with no value yet: choosing a file appends rather than
              replaces, so adding several in a row needs no "add" step first. */}
          <ImageField
            value={null}
            owner={owner}
            onChange={(ref) => setItems((prev) => [...prev, ref])}
          />
        </div>
      ) : null}

      <Footer onCancel={onCancel} disabled={items.length === 0} />
    </form>
  );
}

function StatsForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { value: number; label: string; suffix: string | null }[];
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  // Kept as strings while editing. A number input bound to a number cannot hold
  // the empty state someone passes through while clearing the field, and
  // snapping it back to 0 mid-edit fights the person typing.
  const [items, setItems] = useState(
    initial.length > 0
      ? initial.map((item) => ({
          value: String(item.value),
          label: item.label,
          suffix: item.suffix ?? "",
        }))
      : [{ value: "", label: "", suffix: "" }],
  );

  const update = (index: number, patch: Partial<(typeof items)[number]>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          items: items
            .filter((item) => item.label.trim().length > 0 && item.value.trim().length > 0)
            .map((item) => ({
              value: Number(item.value),
              label: item.label,
              suffix: item.suffix.trim() || null,
            })),
        });
      }}
    >
      <h2 className="font-display text-lg">Numbers</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Each one counts up when it scrolls into view.
      </p>

      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="space-y-2 rounded-brutal border-2 border-ink bg-canvas p-3"
          >
            <div className="flex gap-2">
              <input
                value={item.value}
                onChange={(event) => update(index, { value: event.target.value })}
                inputMode="numeric"
                placeholder="120"
                aria-label="Number"
                className={FIELD}
              />
              <input
                value={item.suffix}
                onChange={(event) => update(index, { suffix: event.target.value })}
                placeholder="+"
                aria-label="Suffix"
                maxLength={8}
                className={`${FIELD} max-w-20`}
              />
            </div>
            <input
              value={item.label}
              onChange={(event) => update(index, { label: event.target.value })}
              placeholder="Projects shipped"
              aria-label="Label"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              className="text-xs font-semibold underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {items.length < MAX_STATS ? (
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { value: "", label: "", suffix: "" }])}
          className="mt-3 rounded-full border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          Add another
        </button>
      ) : null}

      <Footer onCancel={onCancel} />
    </form>
  );
}

function ListForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { text: string; url: string | null }[];
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(
    initial.length > 0
      ? initial.map((item) => ({ text: item.text, url: item.url ?? "" }))
      : [{ text: "", url: "" }],
  );

  const update = (index: number, patch: Partial<(typeof items)[number]>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          items: items
            .filter((item) => item.text.trim().length > 0)
            .map((item) => ({ text: item.text, url: item.url.trim() || null })),
        });
      }}
    >
      <h2 className="font-display text-lg">List</h2>
      <p className="mt-2 text-xs font-medium text-ink/70">
        Books, tools, songs, anything. Rows fade in one after another, and a link
        is optional.
      </p>

      <ul className="mt-3 space-y-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="space-y-2 rounded-brutal border-2 border-ink bg-canvas p-3"
          >
            <input
              value={item.text}
              onChange={(event) => update(index, { text: event.target.value })}
              placeholder="What it is"
              aria-label="Text"
              className={FIELD}
            />
            <input
              value={item.url}
              onChange={(event) => update(index, { url: event.target.value })}
              placeholder="https://… (optional)"
              aria-label="Link"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              className="text-xs font-semibold underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {items.length < MAX_LIST_ITEMS ? (
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { text: "", url: "" }])}
          className="mt-3 rounded-full border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold shadow-brutal-sm nb-press-sm"
        >
          Add another
        </button>
      ) : null}

      <Footer onCancel={onCancel} />
    </form>
  );
}

function IdentityForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string | null;
  onSave: (content: unknown) => void;
  onCancel: () => void;
}) {
  const [tagline, setTagline] = useState(initial ?? "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ tagline: tagline.trim() || null });
      }}
    >
      <h2 className="font-display text-lg">About you</h2>
      {/* Says outright where the rest comes from. Without this the card looks
          like it is missing fields rather than reading them from one place. */}
      <p className="mt-2 text-xs font-medium text-ink/70">
        Your name, photo and bio come from your profile, so changing them there
        updates this card too. Only the line below belongs to this block.
      </p>

      <label className="mt-3 block">
        <span className="block text-xs font-semibold">Tagline (optional)</span>
        <input
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
          placeholder="Designer, Lagos"
          className={`mt-1 ${FIELD}`}
        />
      </label>

      <Footer onCancel={onCancel} />
    </form>
  );
}

"use client";

import { useState } from "react";

import {
  MAX_BLOCK_SCALE,
  MIN_BLOCK_SCALE,
  parseBlockStyle,
  type BlockAlign,
  type BlockTone,
} from "@/lib/site/block-style";
import { useSiteStore } from "@/lib/site/store";
import type { SiteBlock } from "@/lib/site/read";

const ALIGNS: { value: BlockAlign; label: string; glyph: string }[] = [
  { value: "start", label: "Align left", glyph: "⭰" },
  { value: "center", label: "Align centre", glyph: "⭲" },
  { value: "end", label: "Align right", glyph: "⭲" },
];

const TONES: { value: BlockTone; label: string }[] = [
  { value: "surface", label: "Card" },
  { value: "plain", label: "No box" },
  { value: "accent", label: "Accent" },
];

/**
 * Alignment, tone and size for one block (site-spec S7).
 *
 * Lives in the inspector rather than in the edit sheet, because these are the
 * controls you reach for WHILE looking at the layout — opening a modal to nudge
 * one block's size and closing it to see the result is the interaction this is
 * meant to replace. On a wide display the panel is a rail beside the canvas, so
 * the block is still in view while these move; below `xl` the sheet covers the
 * lower half of the screen and the block stays visible above it.
 *
 * The style shown is the DRAFT's, so every control here is the block's real
 * current value and needs no local copy. The one exception is the scale slider,
 * and it is an exception about INPUT rather than about saving: a range fires for
 * every pixel of travel, and the thumb has to track the finger between the
 * frames where a value is committed. `dragging` holds that in-between position
 * and nothing else — it is dropped the moment the finger lifts and the real
 * value takes over.
 *
 * (Committing on release is now belt to the queue's braces: repeated writes to
 * one block's style coalesce, so even the every-pixel version would send once.
 * It stays because a slider that saves 40 times and a slider that saves once are
 * indistinguishable here and only one of them is honest about intent.)
 */
export function BlockStyleControls({ block }: { block: SiteBlock }) {
  const { mutate } = useSiteStore();
  const stored = parseBlockStyle(block.style);
  const [dragging, setDragging] = useState<number | null>(null);

  const style = dragging === null ? stored : { ...stored, scale: dragging };

  const save = (next: typeof style) => {
    setDragging(null);
    mutate({ kind: "setBlockStyle", blockId: block.id, style: next });
  };

  return (
    // No divider rule of its own any more: this used to be stapled under a
    // block's header on the canvas and needed a line to separate itself from
    // it. It is a group in the inspector now (editor-panel.tsx), which supplies
    // the heading and the spacing.
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Alignment">
        {ALIGNS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={style.align === option.value}
            onClick={() => save({ ...style, align: option.value })}
            className={`flex size-9 items-center justify-center rounded-full border-2 border-ink text-xs font-bold shadow-brutal-sm nb-press-sm ${
              style.align === option.value ? "bg-lilac" : "bg-paper"
            }`}
          >
            {/* Text glyphs rather than icons: three alignment marks are not
                worth an icon set, and the accessible name is on the button. */}
            <span aria-hidden>
              {option.value === "start" ? "≡" : option.value === "center" ? "≣" : "≡"}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-1" role="group" aria-label="Style">
        {TONES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={style.tone === option.value}
            onClick={() => save({ ...style, tone: option.value })}
            className={`min-h-9 rounded-full border-2 border-ink px-2.5 text-xs font-semibold shadow-brutal-sm nb-press-sm ${
              style.tone === option.value ? "bg-lilac" : "bg-paper"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Only offered when the block is actually filled with the accent —
          a colour control on a block that shows no colour is a control that
          appears to do nothing. */}
      {style.tone === "accent" ? (
        <label className="inline-flex min-h-9 items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-2 shadow-brutal-sm">
          <span className="sr-only">Block colour</span>
          <input
            type="color"
            value={style.accent ?? "#bca6f7"}
            onChange={(event) => save({ ...style, accent: event.target.value })}
            className="size-6 cursor-pointer rounded-full border-2 border-ink bg-transparent p-0"
          />
          {style.accent ? (
            <button
              type="button"
              onClick={() => save({ ...style, accent: null })}
              className="text-xs font-semibold underline"
            >
              reset
            </button>
          ) : (
            <span className="text-xs font-medium text-ink/70">page</span>
          )}
        </label>
      ) : null}

      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold">Size</span>
        <input
          type="range"
          min={MIN_BLOCK_SCALE}
          max={MAX_BLOCK_SCALE}
          step={0.05}
          value={style.scale}
          onChange={(event) => setDragging(Number(event.target.value))}
          onPointerUp={() => save(style)}
          onKeyUp={() => save(style)}
          // A drag that leaves the control still ends somewhere. Without this
          // the thumb keeps the in-between value on screen with nothing queued
          // behind it, which is the one shape of lost edit this design can have.
          onBlur={() => (dragging === null ? undefined : save(style))}
          className="min-w-16 flex-1 accent-ink"
        />
        <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums">
          {style.scale.toFixed(2).replace(/0$/, "")}×
        </span>
      </label>
    </div>
  );
}

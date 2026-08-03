import { describe, expect, it } from "vitest";

import {
  BLOCK_ALIGNS,
  BLOCK_TONES,
  DEFAULT_BLOCK_STYLE,
  MAX_BLOCK_SCALE,
  MIN_BLOCK_SCALE,
  clampBlockScale,
  isBlockAlign,
  isBlockTone,
  parseBlockStyle,
} from "./block-style";

describe("clampBlockScale", () => {
  it("keeps a value in range", () => {
    expect(clampBlockScale(1.25)).toBe(1.25);
    expect(clampBlockScale("1.5")).toBe(1.5);
  });

  it("clamps to the ends rather than rejecting", () => {
    expect(clampBlockScale(0.1)).toBe(MIN_BLOCK_SCALE);
    expect(clampBlockScale(99)).toBe(MAX_BLOCK_SCALE);
  });

  it("falls back to the default for a non-number, never to the minimum", () => {
    // The trap: `Number(null)` and `Number([])` are both 0, and 0 CLAMPS to
    // 0.8. A block with no scale set would come back visibly shrunk. The type
    // narrowing has to happen before the clamp, not after.
    for (const value of [null, undefined, {}, [], NaN, Infinity]) {
      expect(clampBlockScale(value)).toBe(1);
    }
  });

  it("rounds to two places", () => {
    // This becomes a CSS custom property; a 17-digit float there is noise in
    // every serialised page.
    expect(clampBlockScale(1 / 3 + 1)).toBe(1.33);
    expect(String(clampBlockScale(1.005))).not.toContain("00000");
  });
});

describe("parseBlockStyle", () => {
  it("round-trips a valid style", () => {
    expect(
      parseBlockStyle({ align: "center", tone: "accent", scale: 1.2, accent: "#FF0000" }),
    ).toEqual({
      align: "center",
      tone: "accent",
      scale: 1.2,
      accent: "#ff0000",
    });
  });

  it("never returns null", () => {
    for (const input of [null, undefined, "center", 7, []]) {
      expect(parseBlockStyle(input)).toEqual(DEFAULT_BLOCK_STYLE);
    }
  });

  it("falls back per field", () => {
    // A block with one good field should keep it. Discarding the lot would
    // silently undo a choice its owner did make.
    expect(parseBlockStyle({ align: "end", tone: "nope", scale: "x" })).toEqual({
      ...DEFAULT_BLOCK_STYLE,
      align: "end",
    });
  });

  it("drops unknown keys entirely", () => {
    // The whole reason style is stored as scalars rather than as CSS: nothing
    // a hand-written column contains can reach a stylesheet.
    const parsed = parseBlockStyle({
      align: "start",
      tone: "surface",
      scale: 1,
      accent: "url(https://tracker.example/x)",
      background: "url(https://tracker.example/x)",
      cssText: "position:fixed;inset:0",
    });
    expect(Object.keys(parsed).sort()).toEqual(["accent", "align", "scale", "tone"]);
  });

  it("guards agree with the sets", () => {
    for (const align of BLOCK_ALIGNS) expect(isBlockAlign(align)).toBe(true);
    for (const tone of BLOCK_TONES) expect(isBlockTone(tone)).toBe(true);
    expect(isBlockAlign("centre")).toBe(false);
    expect(isBlockTone("")).toBe(false);
  });
});

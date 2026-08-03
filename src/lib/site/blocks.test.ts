import { describe, expect, it } from "vitest";

import {
  BLOCK_CATALOGUE,
  MAX_GALLERY_IMAGES,
  MAX_LIST_ITEMS,
  MAX_RICH_NODES,
  MAX_SPAN_LENGTH,
  MAX_STATS,
  isBlockType,
  isMediaId,
  parseBlockContent,
  parseRichDoc,
  richDocToText,
  safeHref,
  socialUrl,
  textToRichDoc,
} from "./blocks";

/**
 * Block content is owner-writable through PostgREST and lands on a page anyone
 * can open, so these tests are the boundary between "the database said so" and
 * "we rendered it". The `safeHref` cases in particular are the ones that would
 * be an XSS if the answer were ever `true`.
 */
describe("safeHref", () => {
  it("accepts https and mailto", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  describe("rejects", () => {
    it.each([
      ["javascript", "javascript:alert(1)"],
      ["javascript with padding", "  javascript:alert(1)  "],
      ["mixed-case javascript", "JaVaScRiPt:alert(1)"],
      // The classic bypass for a naive `startsWith("javascript:")` check.
      ["javascript with an embedded tab", "java\tscript:alert(1)"],
      ["javascript with a newline", "java\nscript:alert(1)"],
      ["data url", "data:text/html,<script>alert(1)</script>"],
      ["vbscript", "vbscript:msgbox(1)"],
      ["file", "file:///etc/passwd"],
      ["blob", "blob:https://example.com/x"],
      // Excluded deliberately: we would be publishing a plaintext downgrade on
      // someone else's behalf.
      ["plain http", "http://example.com"],
      ["a bare domain, which is not a url", "example.com"],
      ["a relative path", "/somewhere"],
      ["a protocol-relative url", "//example.com"],
      ["empty", ""],
      ["whitespace", "   "],
      ["a non-string", 42],
      ["null", null],
    ])("%s", (_label, input) => {
      expect(safeHref(input)).toBeNull();
    });
  });

  it("rejects an absurdly long url rather than storing it", () => {
    expect(safeHref(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("parseRichDoc", () => {
  it("accepts a simple paragraph", () => {
    expect(parseRichDoc({ v: 1, nodes: [{ t: "p", c: [{ s: "hello" }] }] })).toEqual({
      v: 1,
      nodes: [{ t: "p", c: [{ s: "hello" }] }],
    });
  });

  it("keeps bold and italic but drops anything else on a span", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "p", c: [{ s: "hi", b: true, i: true, onclick: "evil()" }] }],
    });
    expect(doc?.nodes[0]).toEqual({ t: "p", c: [{ s: "hi", b: true, i: true }] });
  });

  /**
   * The span survives, the link does not. Dropping the whole span would delete a
   * sentence from someone's page because of one bad attribute on it.
   */
  it("strips an unsafe href but keeps the text", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "p", c: [{ s: "click me", href: "javascript:alert(1)" }] }],
    });
    expect(doc?.nodes[0]).toEqual({ t: "p", c: [{ s: "click me" }] });
  });

  it("keeps a safe href", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "p", c: [{ s: "docs", href: "https://example.com/" }] }],
    });
    expect(doc?.nodes[0]).toEqual({
      t: "p",
      c: [{ s: "docs", href: "https://example.com/" }],
    });
  });

  it("accepts lists", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "ul", items: [[{ s: "one" }], [{ s: "two" }]] }],
    });
    expect(doc?.nodes[0]).toEqual({
      t: "ul",
      items: [[{ s: "one" }], [{ s: "two" }]],
    });
  });

  it("drops unknown node types instead of rendering them", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "script", c: [{ s: "evil" }] }, { t: "p", c: [{ s: "fine" }] }],
    });
    expect(doc?.nodes).toEqual([{ t: "p", c: [{ s: "fine" }] }]);
  });

  it("truncates a span rather than storing an unbounded string", () => {
    const doc = parseRichDoc({
      v: 1,
      nodes: [{ t: "p", c: [{ s: "x".repeat(MAX_SPAN_LENGTH + 500) }] }],
    });
    expect((doc?.nodes[0] as { c: { s: string }[] }).c[0].s).toHaveLength(MAX_SPAN_LENGTH);
  });

  it("caps the node count", () => {
    const nodes = Array.from({ length: MAX_RICH_NODES + 20 }, () => ({
      t: "p",
      c: [{ s: "n" }],
    }));
    expect(parseRichDoc({ v: 1, nodes })?.nodes).toHaveLength(MAX_RICH_NODES);
  });

  describe("rejects", () => {
    it.each([
      ["a missing version", { nodes: [] }],
      ["a future version", { v: 2, nodes: [{ t: "p", c: [{ s: "x" }] }] }],
      ["nodes that aren't an array", { v: 1, nodes: "text" }],
      ["a document with no usable nodes", { v: 1, nodes: [{ t: "script" }] }],
      ["an empty document", { v: 1, nodes: [] }],
      ["a string", "hello"],
      ["null", null],
    ])("%s", (_label, input) => {
      expect(parseRichDoc(input)).toBeNull();
    });
  });
});

describe("textToRichDoc", () => {
  it("turns a blank line-separated body into paragraphs", () => {
    expect(textToRichDoc("one\n\ntwo")?.nodes).toEqual([
      { t: "p", c: [{ s: "one" }] },
      { t: "p", c: [{ s: "two" }] },
    ]);
  });

  it("reads heading markers", () => {
    expect(textToRichDoc("## Title\n### Sub")?.nodes).toEqual([
      { t: "h2", c: [{ s: "Title" }] },
      { t: "h3", c: [{ s: "Sub" }] },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    expect(textToRichDoc("- a\n- b")?.nodes).toEqual([
      { t: "ul", items: [[{ s: "a" }], [{ s: "b" }]] },
    ]);
  });

  it("groups numbered lines into an ordered list", () => {
    expect(textToRichDoc("1. a\n2) b")?.nodes).toEqual([
      { t: "ol", items: [[{ s: "a" }], [{ s: "b" }]] },
    ]);
  });

  it("starts a new list when the marker changes", () => {
    const nodes = textToRichDoc("- a\n1. b")?.nodes;
    expect(nodes).toEqual([
      { t: "ul", items: [[{ s: "a" }]] },
      { t: "ol", items: [[{ s: "b" }]] },
    ]);
  });

  it("links a bare https url", () => {
    expect(textToRichDoc("see https://example.com/x now")?.nodes).toEqual([
      {
        t: "p",
        c: [
          { s: "see " },
          { s: "https://example.com/x", href: "https://example.com/x" },
          { s: " now" },
        ],
      },
    ]);
  });

  it("leaves trailing punctuation outside the link", () => {
    expect(textToRichDoc("go to https://example.com.")?.nodes).toEqual([
      {
        t: "p",
        c: [
          { s: "go to " },
          { s: "https://example.com", href: "https://example.com/" },
          { s: "." },
        ],
      },
    ]);
  });

  /**
   * http is not linked and not upgraded — it is left as literal text. Turning it
   * into a link would be publishing a plaintext downgrade on the author's behalf.
   */
  it("does not link plain http", () => {
    expect(textToRichDoc("visit http://example.com")?.nodes).toEqual([
      { t: "p", c: [{ s: "visit http://example.com" }] },
    ]);
  });

  it("is null for empty or whitespace-only input", () => {
    expect(textToRichDoc("")).toBeNull();
    expect(textToRichDoc("   \n\n  ")).toBeNull();
  });

  it("survives a round trip through the renderer's own parser", () => {
    const doc = textToRichDoc("## Title\n\nbody\n\n- one\n- two");
    expect(parseRichDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe("richDocToText", () => {
  it("round-trips a document back to editable text", () => {
    const source = "## Title\n\nA paragraph.\n\n- one\n- two";
    const doc = textToRichDoc(source);
    expect(richDocToText(doc!)).toBe(source);
  });

  it("round-trips numbered lists, renumbering from one", () => {
    const doc = textToRichDoc("3. a\n7. b");
    expect(richDocToText(doc!)).toBe("1. a\n2. b");
  });

  it("is stable — text out, parsed again, gives the same document", () => {
    const doc = textToRichDoc("## H\n\ntext https://example.com/ here\n\n- x");
    const again = textToRichDoc(richDocToText(doc!));
    expect(again).toEqual(doc);
  });
});

describe("parseBlockContent", () => {
  it("returns null for an unknown type, so a rollback renders a gap not a crash", () => {
    expect(parseBlockContent("gallery", { media_ids: [] })).toBeNull();
    expect(parseBlockContent("", {})).toBeNull();
  });

  describe("links", () => {
    it("keeps safe links and drops unsafe ones from the same block", () => {
      const parsed = parseBlockContent("links", {
        items: [
          { label: "Site", url: "https://example.com" },
          { label: "Bad", url: "javascript:alert(1)" },
        ],
      });
      expect(parsed).toEqual({
        type: "links",
        content: { items: [{ label: "Site", url: "https://example.com/" }] },
      });
    });

    it("falls back to the host when a label is missing", () => {
      const parsed = parseBlockContent("links", {
        items: [{ url: "https://example.com/deep/path" }],
      });
      expect(parsed).toEqual({
        type: "links",
        content: { items: [{ label: "example.com", url: "https://example.com/deep/path" }] },
      });
    });

    it("is null when nothing survived", () => {
      expect(
        parseBlockContent("links", { items: [{ label: "x", url: "javascript:1" }] }),
      ).toBeNull();
    });
  });

  describe("socials", () => {
    it("builds the url from the network table, never from stored input", () => {
      const parsed = parseBlockContent("socials", {
        items: [{ network: "github", handle: "torvalds" }],
      });
      expect(parsed).toEqual({
        type: "socials",
        content: { items: [{ network: "github", handle: "torvalds" }], variant: "chips" },
      });
      expect(socialUrl("github", "torvalds")).toBe("https://github.com/torvalds");
    });

    it("strips a leading @, which people paste constantly", () => {
      const parsed = parseBlockContent("socials", {
        items: [{ network: "instagram", handle: "@ada" }],
      });
      expect(parsed).toMatchObject({ content: { items: [{ handle: "ada" }] } });
    });

    it("rejects an unknown network", () => {
      expect(
        parseBlockContent("socials", { items: [{ network: "myspace", handle: "ada" }] }),
      ).toBeNull();
    });

    /**
     * The handle becomes a path segment in a URL we construct, so anything that
     * could escape that segment has to be refused rather than encoded away.
     */
    it.each([
      ["a slash", "ada/../../evil"],
      ["a full url", "https://evil.example"],
      ["a space", "ada smith"],
      ["a question mark", "ada?next=evil"],
      ["a hash", "ada#x"],
      ["an at sign inside", "ada@evil"],
      ["empty after stripping @", "@"],
    ])("rejects a handle containing %s", (_label, handle) => {
      expect(parseBlockContent("socials", { items: [{ network: "x", handle }] })).toBeNull();
    });
  });
});

const UUID = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const OTHER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("parseBlockContent — image", () => {
  const ok = { image: { id: UUID, v: 17, w: 1200, h: 800, alt: "A studio" }, caption: "Hi" };

  it("round-trips a complete image", () => {
    expect(parseBlockContent("image", ok)).toEqual({
      type: "image",
      content: {
        image: { id: UUID, v: 17, w: 1200, h: 800, alt: "A studio" },
        caption: "Hi",
      },
    });
  });

  it("keeps an empty alt rather than dropping the image", () => {
    // Empty alt is how you mark an image decorative. Treating it as missing
    // would either delete the picture or force a description onto something
    // that should announce nothing.
    const parsed = parseBlockContent("image", {
      image: { ...ok.image, alt: "" },
      caption: null,
    });
    expect(parsed?.type).toBe("image");
    expect(parsed?.type === "image" && parsed.content.image.alt).toBe("");
  });

  it("blanks a missing alt instead of rejecting", () => {
    const parsed = parseBlockContent("image", { image: { id: UUID, v: 1, w: 10, h: 10 } });
    expect(parsed?.type === "image" && parsed.content.image.alt).toBe("");
  });

  describe("rejects ids that are not bare UUIDs", () => {
    // The id becomes a path segment in a Cloudinary URL under the OWNER's
    // folder, and Cloudinary public_ids may contain slashes — so anything that
    // could climb out of that folder has to fail here, not be sanitised later.
    const bad = [
      "../../avatars/user_someone",
      `${UUID}/../../avatars/user_someone`,
      `qr-connect/sites/user_x/${UUID}`,
      `${UUID}.jpg`,
      UUID.toUpperCase(),
      `${UUID} `,
      "",
      "not-a-uuid",
      123,
      null,
    ];

    for (const id of bad) {
      it(String(id), () => {
        expect(parseBlockContent("image", { image: { id, v: 1, w: 1, h: 1 } })).toBeNull();
      });
    }
  });

  it("rejects a missing or bogus version", () => {
    // Without a version the delivery URL cannot be built, and a cached copy of
    // a replaced image could outlive the replacement. Note `null` is covered by
    // the `>= 1` bound rather than by the type check — `Number(null)` is 0.
    for (const v of [0, -1, 1.5, null, undefined, "abc", {}]) {
      expect(parseBlockContent("image", { image: { ...ok.image, v } })).toBeNull();
    }
  });

  it("coerces a stringified version", () => {
    // A number that came back from JSON as a string is a round-trip artifact,
    // not an attack, and the `>= 1` integer bound already fences the range.
    // Dropping the image over it would lose a photo to a type nobody chose.
    const parsed = parseBlockContent("image", { image: { ...ok.image, v: "17" } });
    expect(parsed?.type === "image" && parsed.content.image.v).toBe(17);
  });

  it("clamps absurd dimensions instead of dropping the image", () => {
    const parsed = parseBlockContent("image", {
      image: { ...ok.image, w: 10 ** 9, h: -4 },
    });
    expect(parsed?.type === "image" && parsed.content.image.w).toBe(20000);
    expect(parsed?.type === "image" && parsed.content.image.h).toBe(1000);
  });

  it("drops a blank caption to null", () => {
    const parsed = parseBlockContent("image", { image: ok.image, caption: "   " });
    expect(parsed?.type === "image" && parsed.content.caption).toBeNull();
  });
});

describe("parseBlockContent — gallery", () => {
  const ref = (id: string) => ({ id, v: 2, w: 100, h: 100, alt: "" });

  it("keeps the good images and drops only the bad ones", () => {
    const parsed = parseBlockContent("gallery", {
      items: [ref(UUID), ref("../escape"), ref(OTHER_UUID)],
    });
    expect(parsed?.type === "gallery" && parsed.content.items.map((i) => i.id)).toEqual([
      UUID,
      OTHER_UUID,
    ]);
  });

  it("caps the gallery", () => {
    const items = Array.from({ length: MAX_GALLERY_IMAGES + 8 }, () => ref(UUID));
    const parsed = parseBlockContent("gallery", { items });
    expect(parsed?.type === "gallery" && parsed.content.items.length).toBe(
      MAX_GALLERY_IMAGES,
    );
  });

  it("is null when nothing survives", () => {
    expect(parseBlockContent("gallery", { items: [ref("nope")] })).toBeNull();
    expect(parseBlockContent("gallery", { items: [] })).toBeNull();
  });
});

describe("parseBlockContent — stats", () => {
  it("keeps a whole number and its suffix", () => {
    const parsed = parseBlockContent("stats", {
      items: [{ value: 1200, label: "Cups of coffee", suffix: "+" }],
    });
    expect(parsed).toEqual({
      type: "stats",
      content: { items: [{ value: 1200, label: "Cups of coffee", suffix: "+" }] },
    });
  });

  it("rejects a non-finite value", () => {
    // The renderer springs from 0 to this. NaN or Infinity is not a display
    // glitch, it is an animation that never settles.
    for (const value of ["abc", null, {}]) {
      expect(parseBlockContent("stats", { items: [{ value, label: "x" }] })).toBeNull();
    }
  });

  it("requires a label", () => {
    expect(parseBlockContent("stats", { items: [{ value: 4, label: "  " }] })).toBeNull();
  });

  it("caps the count and the magnitude", () => {
    const parsed = parseBlockContent("stats", {
      items: [
        ...Array.from({ length: MAX_STATS + 3 }, () => ({ value: 1, label: "x" })),
      ],
    });
    expect(parsed?.type === "stats" && parsed.content.items.length).toBe(MAX_STATS);

    const huge = parseBlockContent("stats", { items: [{ value: 1e20, label: "x" }] });
    expect(huge?.type === "stats" && huge.content.items[0].value).toBe(1e12);
  });
});

describe("parseBlockContent — list", () => {
  it("keeps the row and its link", () => {
    expect(
      parseBlockContent("list", { items: [{ text: "Dune", url: "https://example.com" }] }),
    ).toEqual({
      type: "list",
      content: { items: [{ text: "Dune", url: "https://example.com/" }] },
    });
  });

  it("drops an unsafe link but keeps the row", () => {
    // Same rule as a rich-text span: losing a URL must not delete the line
    // that mentioned it.
    const parsed = parseBlockContent("list", {
      items: [{ text: "Dune", url: "javascript:alert(1)" }],
    });
    expect(parsed?.type === "list" && parsed.content.items).toEqual([
      { text: "Dune", url: null },
    ]);
  });

  it("requires text", () => {
    expect(parseBlockContent("list", { items: [{ text: "  ", url: null }] })).toBeNull();
  });

  it("caps the list", () => {
    const items = Array.from({ length: MAX_LIST_ITEMS + 5 }, () => ({ text: "x" }));
    const parsed = parseBlockContent("list", { items });
    expect(parsed?.type === "list" && parsed.content.items.length).toBe(MAX_LIST_ITEMS);
  });
});

describe("isMediaId", () => {
  it("accepts a lowercase v4 UUID and nothing else", () => {
    expect(isMediaId(UUID)).toBe(true);
    expect(isMediaId(UUID.toUpperCase())).toBe(false);
    expect(isMediaId(`a/${UUID}`)).toBe(false);
    expect(isMediaId(undefined)).toBe(false);
  });
});

describe("BLOCK_CATALOGUE", () => {
  it("offers only types the renderer can parse", () => {
    // The bug this guards: the editor's buttons and addBlock's starter content
    // were two lists, and four buttons shipped that answered "Unknown block
    // type." They are one list now; this pins the other half of the contract —
    // every offered type must survive parseBlockContent given real content.
    for (const entry of BLOCK_CATALOGUE) {
      expect(isBlockType(entry.type), `${entry.type} is not a BlockType`).toBe(true);
    }
  });

  it("has a unique, non-empty label for each entry", () => {
    const labels = BLOCK_CATALOGUE.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
  });

  it("rejects anything not in the catalogue", () => {
    for (const value of ["", "script", "Text", null, undefined, 1]) {
      expect(isBlockType(value)).toBe(false);
    }
  });
});

describe("socials variant", () => {
  const items = [{ network: "github", handle: "torvalds" }];

  it("defaults to chips", () => {
    // Chips are the accessible default: mark AND name, so the block works with
    // images off and on a screen reader. The dock is opt-in.
    const parsed = parseBlockContent("socials", { items });
    expect(parsed?.type === "socials" && parsed.content.variant).toBe("chips");
  });

  it("keeps a known variant and rejects an unknown one", () => {
    const dock = parseBlockContent("socials", { items, variant: "dock" });
    expect(dock?.type === "socials" && dock.content.variant).toBe("dock");

    const bogus = parseBlockContent("socials", { items, variant: "carousel" });
    expect(bogus?.type === "socials" && bogus.content.variant).toBe("chips");
  });
});

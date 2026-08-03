/**
 * Block content schemas (site-spec S5/S6).
 *
 * Every block's `content` is JSONB, owner-writable through PostgREST, and ends
 * up rendered on a page anyone can open. So nothing here trusts the database:
 * each type has a parser that returns a well-formed value or null, and the
 * renderer draws nothing for null. A block with corrupt content is a gap on the
 * page, never a broken page and never an injection.
 *
 * THERE IS NO HTML ANYWHERE IN THIS FILE, AND THAT IS THE POINT. Rich text is a
 * constrained node tree that the renderer maps to React elements, so there is no
 * `dangerouslySetInnerHTML` to audit and no sanitiser to keep patched — the same
 * argument §3 makes for banning newlines in vCard fields, applied one layer
 * earlier. Storing HTML and cleaning it on the way out is the design this
 * replaces, not an alternative to it.
 */

/** Caps mirror the 16KB `content` column limit; these keep one block sane. */
export const MAX_RICH_NODES = 60;
export const MAX_SPANS_PER_NODE = 40;
export const MAX_SPAN_LENGTH = 2000;
export const MAX_LINKS = 20;
export const MAX_SOCIALS = 12;
export const MAX_LABEL_LENGTH = 80;
/** A bento cell is at most a quarter of a band; more than this is a scroll. */
export const MAX_GALLERY_IMAGES = 12;
export const MAX_STATS = 6;
export const MAX_LIST_ITEMS = 20;
export const MAX_ALT_LENGTH = 240;
export const MAX_CAPTION_LENGTH = 160;

export type RichSpan = { s: string; b?: true; i?: true; href?: string };
export type RichNode =
  | { t: "p" | "h2" | "h3"; c: RichSpan[] }
  | { t: "ul" | "ol"; items: RichSpan[][] };
export type RichDoc = { v: 1; nodes: RichNode[] };

export type TextContent = { doc: RichDoc };
export type LinksContent = { items: { label: string; url: string }[] };
export const SOCIAL_VARIANTS = ["chips", "dock"] as const;
export type SocialVariant = (typeof SOCIAL_VARIANTS)[number];

export type SocialsContent = {
  items: { network: SocialNetwork; handle: string }[];
  /**
   * `chips` shows mark + name + handle; `dock` is icon-only and magnifies.
   * Default is `chips` because it is the one that works with images off, on a
   * screen reader, and for a viewer who has never seen the Bluesky butterfly.
   */
  variant: SocialVariant;
};

/**
 * A stored reference to one uploaded image.
 *
 * `id` is a bare UUID, NOT a path and not a URL — `mediaUrl()` rebuilds the
 * Cloudinary public_id from it plus the profile id the page was looked up by.
 * See the note at the top of `media.ts`: this is what makes it impossible for a
 * block to point at another account's image rather than merely disallowed.
 *
 * `w`/`h` are the stored pixel dimensions and exist for ONE reason: laying out
 * before the bytes arrive. A gallery that waits to measure loaded images
 * reflows on every one of them, which on a slow connection is the whole page
 * jumping for several seconds. They are advisory — a wrong value skews the
 * owner's own layout and nothing else — so they are clamped, not verified.
 */
export type ImageRef = { id: string; v: number; w: number; h: number; alt: string };

export type ImageContent = { image: ImageRef; caption: string | null };
export type GalleryContent = { items: ImageRef[] };
export type StatsContent = { items: { value: number; label: string; suffix: string | null }[] };
export type ListContent = { items: { text: string; url: string | null }[] };

/**
 * The identity block stores ONLY a tagline. Name, photo, bio and handle come
 * from the profile at render time — see identity-block.tsx for why copying them
 * in would be a bug rather than a shortcut.
 */
export type IdentityContent = { tagline: string | null };

export type BlockContent =
  | { type: "text"; content: TextContent }
  | { type: "links"; content: LinksContent }
  | { type: "socials"; content: SocialsContent }
  | { type: "image"; content: ImageContent }
  | { type: "gallery"; content: GalleryContent }
  | { type: "stats"; content: StatsContent }
  | { type: "list"; content: ListContent }
  | { type: "identity"; content: IdentityContent };

export type BlockType = BlockContent["type"];

/**
 * The catalogue: what the editor offers, in the order it offers it.
 *
 * THIS EXISTS BECAUSE IT WAS TWO LISTS AND THEY DRIFTED. The editor's buttons
 * and `addBlock`'s STARTER_CONTENT were separate, so adding four block types to
 * the buttons without adding starters shipped four buttons that answered
 * "Unknown block type." One list, keyed by `BlockType`, turns that from a bug
 * a user finds into a compile error.
 *
 * Order is roughly "how likely is this to be the first thing you add", not
 * alphabetical.
 */
export const BLOCK_CATALOGUE = [
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "links", label: "Links" },
  { type: "socials", label: "Socials" },
  { type: "gallery", label: "Gallery" },
  { type: "stats", label: "Numbers" },
  { type: "list", label: "List" },
  { type: "identity", label: "About you" },
] as const satisfies readonly { type: BlockType; label: string }[];

const BLOCK_TYPES = new Set<string>(BLOCK_CATALOGUE.map((entry) => entry.type));

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.has(value);
}

/**
 * Networks are a closed set with a URL template each, so a social row never
 * stores a URL at all — only which network and which handle.
 *
 * That is a deliberate narrowing: a free-form URL field on a public page is an
 * open redirect and a phishing surface wearing a familiar icon. Someone can
 * still link anywhere they like — that is what the `links` block is for, and it
 * shows the destination as text.
 */
export const SOCIAL_NETWORKS = {
  instagram: { label: "Instagram", url: (h: string) => `https://instagram.com/${h}` },
  x: { label: "X", url: (h: string) => `https://x.com/${h}` },
  linkedin: { label: "LinkedIn", url: (h: string) => `https://linkedin.com/in/${h}` },
  github: { label: "GitHub", url: (h: string) => `https://github.com/${h}` },
  tiktok: { label: "TikTok", url: (h: string) => `https://tiktok.com/@${h}` },
  youtube: { label: "YouTube", url: (h: string) => `https://youtube.com/@${h}` },
  facebook: { label: "Facebook", url: (h: string) => `https://facebook.com/${h}` },
  threads: { label: "Threads", url: (h: string) => `https://threads.net/@${h}` },
  bluesky: { label: "Bluesky", url: (h: string) => `https://bsky.app/profile/${h}` },
  dribbble: { label: "Dribbble", url: (h: string) => `https://dribbble.com/${h}` },
  behance: { label: "Behance", url: (h: string) => `https://behance.net/${h}` },
  whatsapp: { label: "WhatsApp", url: (h: string) => `https://wa.me/${h}` },
} as const;

export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;

/** Conservative on purpose — this is a path segment in a URL we build. */
const SOCIAL_HANDLE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * `https:` and `mailto:` only, checked by parsing rather than by pattern.
 *
 * A regex over a URL string is the wrong tool here: `javascript:alert(1)` and
 * its many encodings are exactly what a hand-rolled check misses, and `URL`
 * already knows how to normalise a scheme. `http:` is excluded as well as the
 * dangerous schemes — a public profile linking out over plaintext is a
 * downgrade we would be publishing on someone's behalf.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return null;
  return parsed.toString();
}

function parseSpan(value: unknown): RichSpan | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.s !== "string") return null;

  const text = raw.s.slice(0, MAX_SPAN_LENGTH);
  if (text.length === 0) return null;

  const span: RichSpan = { s: text };
  if (raw.b === true) span.b = true;
  if (raw.i === true) span.i = true;

  // An unsafe href drops the link but KEEPS the text. Discarding the span would
  // silently delete a sentence because of one bad attribute on it.
  const href = safeHref(raw.href);
  if (href) span.href = href;

  return span;
}

function parseSpans(value: unknown): RichSpan[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SPANS_PER_NODE)
    .map(parseSpan)
    .filter((span): span is RichSpan => span !== null);
}

function parseRichNode(value: unknown): RichNode | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (raw.t === "p" || raw.t === "h2" || raw.t === "h3") {
    const c = parseSpans(raw.c);
    return c.length > 0 ? { t: raw.t, c } : null;
  }

  if (raw.t === "ul" || raw.t === "ol") {
    if (!Array.isArray(raw.items)) return null;
    const items = raw.items
      .slice(0, MAX_SPANS_PER_NODE)
      .map(parseSpans)
      .filter((spans) => spans.length > 0);
    return items.length > 0 ? { t: raw.t, items } : null;
  }

  return null;
}

export function parseRichDoc(value: unknown): RichDoc | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  // Versioned so a future node type can be added without a migration guessing
  // at what old rows meant.
  if (raw.v !== 1 || !Array.isArray(raw.nodes)) return null;

  const nodes = raw.nodes
    .slice(0, MAX_RICH_NODES)
    .map(parseRichNode)
    .filter((node): node is RichNode => node !== null);

  return nodes.length > 0 ? { v: 1, nodes } : null;
}

function parseLinks(value: unknown): LinksContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return null;

  const items = raw
    .slice(0, MAX_LINKS)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const url = safeHref(row.url);
      if (!url) return null;
      const label =
        typeof row.label === "string" && row.label.trim().length > 0
          ? row.label.trim().slice(0, MAX_LABEL_LENGTH)
          : // A link with no label still has to be tappable and readable, so it
            // falls back to its own host rather than rendering as a bare bullet.
            new URL(url).host;
      return { label, url };
    })
    .filter((item): item is { label: string; url: string } => item !== null);

  return items.length > 0 ? { items } : null;
}

function parseSocials(value: unknown): SocialsContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return null;

  const items = raw
    .slice(0, MAX_SOCIALS)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const network = row.network;
      if (typeof network !== "string" || !(network in SOCIAL_NETWORKS)) return null;

      let handle = typeof row.handle === "string" ? row.handle.trim() : "";
      // People paste "@name" constantly; stripping it is kinder than rejecting.
      if (handle.startsWith("@")) handle = handle.slice(1);
      if (!SOCIAL_HANDLE.test(handle)) return null;

      return { network: network as SocialNetwork, handle };
    })
    .filter((item): item is { network: SocialNetwork; handle: string } => item !== null);

  if (items.length === 0) return null;

  const variant = (value as Record<string, unknown>).variant;
  return {
    items,
    variant: (SOCIAL_VARIANTS as readonly string[]).includes(variant as string)
      ? (variant as SocialVariant)
      : "chips",
  };
}

/**
 * A UUID and nothing else.
 *
 * This is the check that keeps `mediaUrl` from being a path-traversal hole: the
 * id becomes a URL segment, so `../../avatars/user_someone` would resolve
 * outside the caller's folder if anything looser were allowed. Cloudinary
 * public_ids permit slashes, which is exactly why this cannot be a
 * "no dangerous characters" filter — it is an allowlist of one shape.
 */
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && MEDIA_ID.test(value);
}

function parseImageRef(value: unknown): ImageRef | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== "string" || !MEDIA_ID.test(raw.id)) return null;

  const version = Number(raw.v);
  if (!Number.isInteger(version) || version < 1) return null;

  // Clamped rather than rejected: a missing or absurd dimension costs an
  // aspect-ratio hint, and dropping the whole image over it would delete a
  // photo from someone's page because a number was wrong.
  const clampDim = (n: unknown) => {
    const value = Number(n);
    return Number.isFinite(value) && value >= 1 ? Math.min(Math.round(value), 20000) : 1000;
  };

  return {
    id: raw.id,
    v: version,
    w: clampDim(raw.w),
    h: clampDim(raw.h),
    // Empty alt is meaningful and must survive: it is how you mark an image
    // decorative. `null` and `""` therefore both mean "announce nothing", and
    // neither is a reason to drop the image.
    alt: typeof raw.alt === "string" ? raw.alt.trim().slice(0, MAX_ALT_LENGTH) : "",
  };
}

function parseImage(value: unknown): ImageContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const image = parseImageRef(raw.image);
  if (!image) return null;

  const caption =
    typeof raw.caption === "string" && raw.caption.trim().length > 0
      ? raw.caption.trim().slice(0, MAX_CAPTION_LENGTH)
      : null;

  return { image, caption };
}

function parseGallery(value: unknown): GalleryContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return null;

  const items = raw
    .slice(0, MAX_GALLERY_IMAGES)
    .map(parseImageRef)
    .filter((item): item is ImageRef => item !== null);

  return items.length > 0 ? { items } : null;
}

function parseStats(value: unknown): StatsContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return null;

  const items = raw
    .slice(0, MAX_STATS)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;

      // `Number()` alone is not enough, and the gap is not theoretical:
      // `Number(null)`, `Number("")` and `Number([])` are all 0, so a stat with
      // no value at all would render as a confident "0" on someone's page.
      // Narrow the TYPE first, then convert.
      const raw = row.value;
      if (typeof raw !== "number" && typeof raw !== "string") return null;
      if (typeof raw === "string" && raw.trim().length === 0) return null;

      const value = Number(raw);
      // The renderer springs from 0 to this, so a non-finite value is not a
      // display bug — it is an animation that never settles.
      if (!Number.isFinite(value)) return null;

      const label =
        typeof row.label === "string" ? row.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
      if (label.length === 0) return null;

      const suffix =
        typeof row.suffix === "string" && row.suffix.trim().length > 0
          ? row.suffix.trim().slice(0, 8)
          : null;

      return { value: Math.trunc(Math.min(Math.max(value, -1e12), 1e12)), label, suffix };
    })
    .filter((item): item is { value: number; label: string; suffix: string | null } => item !== null);

  return items.length > 0 ? { items } : null;
}

function parseList(value: unknown): ListContent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return null;

  const items = raw
    .slice(0, MAX_LIST_ITEMS)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;

      const text =
        typeof row.text === "string" ? row.text.trim().slice(0, MAX_SPAN_LENGTH) : "";
      if (text.length === 0) return null;

      // Same rule as a rich-text span: an unsafe URL drops the LINK, not the
      // line. The reading list still reads.
      return { text, url: safeHref(row.url) };
    })
    .filter((item): item is { text: string; url: string | null } => item !== null);

  return items.length > 0 ? { items } : null;
}

/**
 * The one entry point the renderer uses.
 *
 * An UNKNOWN type returns null rather than throwing, which is what lets
 * `site_blocks.type` be a text column instead of an enum: a deploy that rolls
 * back past a new block type renders those blocks as nothing, rather than
 * failing every page that contains one.
 */
export function parseBlockContent(type: string, content: unknown): BlockContent | null {
  switch (type) {
    case "text": {
      const doc = parseRichDoc((content as Record<string, unknown>)?.doc);
      return doc ? { type: "text", content: { doc } } : null;
    }
    case "links": {
      const parsed = parseLinks(content);
      return parsed ? { type: "links", content: parsed } : null;
    }
    case "socials": {
      const parsed = parseSocials(content);
      return parsed ? { type: "socials", content: parsed } : null;
    }
    case "image": {
      const parsed = parseImage(content);
      return parsed ? { type: "image", content: parsed } : null;
    }
    case "gallery": {
      const parsed = parseGallery(content);
      return parsed ? { type: "gallery", content: parsed } : null;
    }
    case "stats": {
      const parsed = parseStats(content);
      return parsed ? { type: "stats", content: parsed } : null;
    }
    case "list": {
      const parsed = parseList(content);
      return parsed ? { type: "list", content: parsed } : null;
    }
    case "identity": {
      // Never null: this block draws the profile, which always exists. An
      // empty tagline is a card with no tagline, not an empty block.
      const raw = (content as Record<string, unknown>)?.tagline;
      const tagline =
        typeof raw === "string" && raw.trim().length > 0
          ? raw.trim().slice(0, MAX_LABEL_LENGTH)
          : null;
      return { type: "identity", content: { tagline } };
    }
    default:
      return null;
  }
}

export function socialUrl(network: SocialNetwork, handle: string): string {
  return SOCIAL_NETWORKS[network].url(handle);
}

/**
 * ── Plain text ⇄ RichDoc ───────────────────────────────────────────────────
 *
 * The editor writes text blocks in a textarea, not a rich-text editor. That is a
 * deliberate v1 choice rather than a missing feature: a contenteditable surface
 * is the single largest source of cross-browser bugs in an app like this, and on
 * a phone — which is where this app is used — it fights the software keyboard,
 * autocorrect and selection handles in ways that take weeks to get right.
 *
 * A textarea with three line-level conventions gets most of the value at none of
 * that cost, and the STORED format is still the structured tree, so switching to
 * a real editor later changes only how the tree is produced.
 *
 * Bold and italic exist in RichDoc but have no plain-text spelling here. That is
 * on purpose: `**` is easy to type by accident, and a round trip that silently
 * reinterprets someone's asterisks is worse than not supporting them. They stay
 * reachable to a future editor UI.
 */

/**
 * Bare URLs become links. Trailing punctuation is excluded so "see https://x.com."
 * doesn't produce a link with a full stop inside it.
 */
const BARE_URL = /https:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;

function spansFromLine(line: string): RichSpan[] {
  const spans: RichSpan[] = [];
  let cursor = 0;

  for (const match of line.matchAll(BARE_URL)) {
    const start = match.index ?? 0;
    if (start > cursor) spans.push({ s: line.slice(cursor, start) });

    const href = safeHref(match[0]);
    // An unparseable URL stays as literal text rather than vanishing.
    spans.push(href ? { s: match[0], href } : { s: match[0] });
    cursor = start + match[0].length;
  }

  if (cursor < line.length) spans.push({ s: line.slice(cursor) });
  return spans.filter((span) => span.s.length > 0);
}

export function textToRichDoc(text: string): RichDoc | null {
  const nodes: RichNode[] = [];
  let list: { t: "ul" | "ol"; items: RichSpan[][] } | null = null;

  const closeList = () => {
    if (list && list.items.length > 0) nodes.push(list);
    list = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (line.length === 0) {
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      nodes.push({ t: "h3", c: spansFromLine(line.slice(4)) });
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      nodes.push({ t: "h2", c: spansFromLine(line.slice(3)) });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list?.t !== "ul") {
        closeList();
        list = { t: "ul", items: [] };
      }
      list.items.push(spansFromLine(bullet[1]));
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (list?.t !== "ol") {
        closeList();
        list = { t: "ol", items: [] };
      }
      list.items.push(spansFromLine(numbered[1]));
      continue;
    }

    closeList();
    nodes.push({ t: "p", c: spansFromLine(line) });
  }

  closeList();

  // Reuse the parser rather than trusting what was just built: it applies the
  // node/span caps and drops anything empty, so there is exactly one definition
  // of a valid document.
  return parseRichDoc({ v: 1, nodes });
}

/** The inverse, for loading an existing block back into the textarea. */
export function richDocToText(doc: RichDoc): string {
  const spansToText = (spans: RichSpan[]) => spans.map((span) => span.s).join("");

  return doc.nodes
    .map((node) => {
      switch (node.t) {
        case "h2":
          return `## ${spansToText(node.c)}`;
        case "h3":
          return `### ${spansToText(node.c)}`;
        case "p":
          return spansToText(node.c);
        case "ul":
          return node.items.map((item) => `- ${spansToText(item)}`).join("\n");
        case "ol":
          return node.items.map((item, i) => `${i + 1}. ${spansToText(item)}`).join("\n");
      }
    })
    .join("\n\n");
}

/**
 * Starter content for a freshly added block.
 *
 * HERE RATHER THAN IN actions.ts BECAUSE BOTH SIDES NEED THE SAME ANSWER. The
 * editor now draws a new block the instant it is asked for, before the insert
 * has happened, so the client has to produce byte-for-byte what the server will
 * write — otherwise the block changes appearance when the round trip lands,
 * which reads as a glitch rather than a save.
 *
 * Typed by `BlockType`, so a block type that exists but has no starter here is
 * a compile error rather than a button that answers "Unknown block type."
 *
 * LAST IN THE FILE ON PURPOSE. It calls `textToRichDoc` while the module is
 * still evaluating, and that function closes over regexes declared further up —
 * so placing this above them is not a style question, it is a
 * `ReferenceError: Cannot access 'BARE_URL' before initialization` at import
 * time, which takes down every module that transitively imports this one.
 *
 * Every starter except `text` is deliberately EMPTY, and empty means
 * `parseBlockContent` returns null for it. That is the intended state, not a
 * gap: the block renders as nothing on the public page and as "Empty — tap to
 * add content" in the editor, which is exactly right for a block someone just
 * created and has not filled in. Seeding placeholder links or a stock photo
 * would put content on a stranger's page that its owner never chose.
 */
export const STARTER_CONTENT: Record<BlockType, unknown> = {
  text: { doc: textToRichDoc("## A heading\n\nSomething about you.") },
  links: { items: [] },
  socials: { items: [] },
  image: {},
  gallery: { items: [] },
  stats: { items: [] },
  list: { items: [] },
  identity: { tagline: null },
};

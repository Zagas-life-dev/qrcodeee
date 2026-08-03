# Personal Site — Build Specification (v2)

An addendum to `build-spec.md`. Section numbers here are `S<n>` so they never
collide with the core spec's `§n`.

**v2 incorporates `site-spec-review-resolutions.md`.** Rewritten rather than
patched: S4 (layout), S8 (data model), S9 (RLS/blocking), S10 (email), S12
(caching), S13 (tiers) and S15 (build order). Two resolutions are implemented
differently from how they were written — S12.1 and S9.3 — and both say so at the
point of departure, with the reasoning.

## S1. What this is

Every profile gets a **personal site**: a permanent, public page at
`/u/{handle}` that the owner builds out of blocks arranged in sections. It is
the same page a scanner lands on after connecting, so there is one thing to
maintain and one thing to share.

It is deliberately **not** a portfolio builder. A portfolio answers "what has
this person made." This answers "who is this person, and what do I do next" —
which is why the contact save, the connect action and the email capture are
first-class blocks rather than afterthoughts, and why a `status` block that
takes ten seconds to update sits alongside a `work` block that takes an hour.

**Three principles, and the second is load-bearing:**

1. **One page, three audiences.** A stranger from search, someone who just
   scanned the QR, and an existing connection all get the same URL. What differs
   is which blocks render — per-block visibility, not per-audience pages.
2. **Freedom inside a validated token space.** Users choose sections, layout,
   blocks, content, split ratios, order and theme. They do **not** choose
   arbitrary colours, fonts, CSS or HTML. `globals.css` documents exact contrast
   ratios for every fill (coral at 7.25:1 is the floor, lime at 13.52:1 the
   ceiling); a free colour picker throws all of that away and ships inaccessible
   pages under our brand. The freedom is real, it just lives in composition.
3. **Identity is checked before anything renders, and the expensive work is
   cached underneath that check.** See S12 — this is a security boundary before
   it is a performance one, and the ordering matters.

## S2. Two objects: Profile and Site

`profiles` already exists and stays what it is — the contact identity that feeds
the vCard, the connections list, and change notifications. It is small,
structured, and every field on it has a downstream consumer.

`sites` is new and is presentation. Nothing on a site feeds a vCard, and — this
matters — **site edits do not bump `profile_version` and do not fan out change
notifications.** Someone rearranging their layout at midnight must not push
"they updated their profile" to 400 connections. The §5.4 change-detection
triggers stay pointed at `profiles`, `contact_details` and `custom_fields`, and
nothing in S8's new tables gets one.

The site *renders* profile data (name, photo, bio, custom fields, phone, email)
by reference — live pointer, same rule as §1.

## S3. URLs, handles, and the viewer model

### Routes

| Route | Auth | Mutates | Rendering | Renders |
|---|---|---|---|---|
| `/u/{handle}` | none | no | dynamic route, cached site component (S12) | site, public blocks; gated blocks when the viewer qualifies |
| `/connect/{token}` | required | **yes** | dynamic | connect result + the same site renderer |
| `/connections/{profileId}` | required | no | dynamic | the same site renderer + Manage |
| `/site` | owner | yes | dynamic | the editor |

`/connect/{token}` keeps its current job untouched — it is the only one that
calls `connect_via_scan`, and the 15-minute token stays ephemeral (§6). The
handle is the permanent identifier; the token remains a discovery mechanism.

**One renderer, four viewer roles.** `<SiteRenderer site viewer>` where
`viewer ∈ { anonymous, stranger, connection, owner }`. Every block declares the
minimum role it renders for. This is the only place audience logic lives — a
second renderer for the public page would drift from the connected one within a
month, the same argument `/preview` already makes for reusing
`ConnectedProfileCard`.

### Handles

- `profiles.handle citext unique`, 3–30 chars, `^[a-z0-9](?:[a-z0-9_]{1,28})[a-z0-9]$`.
- Reserved list enforced in the DB, not the app: `api, admin, auth, connect, u,
  qr, scan, login, logout, profile, settings, analytics, notifications,
  connections, blocked, goodbye, preview, site, www, help, support, about,
  legal, privacy, terms, static, _next, sw, manifest`.
- Assigned at signup by `handle_new_user()` from the name/email slug plus a
  numeric suffix on collision. Never null — a null handle is a broken share link
  discovered at the worst possible moment.
- **Changing a handle parks the old one.** `handle_history` holds it for 180
  days: the old URL 301s to the new one, and no other account may claim it in
  that window. This is not politeness. People print this URL on business cards
  and embed it in a QR code; letting a released handle be claimed instantly
  turns someone else's printed card into a hijack vector. Rate-limited to 2
  changes per 90 days via the existing `rate_events` mechanism (§7).

## S4. Layout — sections and cells

**Replaces v1's bento grid entirely.** No `w`/`h`, no named sizes, no CSS Grid
dense auto-flow.

### Structure

A page is an ordered list of **sections**. `sort_order` applies at the section
level only. Each section has a `layout_type`:

| `layout_type` | Behaviour |
|---|---|
| `bento` | recursive split tree (below) |
| `row-scroll` | horizontal scroll — carousel / dock |
| `stack-scroll` | vertical scroll-stack, cards pile as you scroll |
| `single` | plain full-width list |

Inside a `bento` section, a cell starts whole and can be **split** — row or
column — into two children, either of which can split again. "2×1 vs 1×2" stops
being a size and becomes a direction. Split ratios are freeform and draggable.

```ts
type Section = {
  id: string;
  sort_order: number;
  layout_type: "bento" | "row-scroll" | "stack-scroll" | "single";
  root_cell: Cell | null;   // bento only; other types use block sort_order
};

type Cell =
  | { type: "component"; block_id: string }
  | { type: "split"; direction: "row" | "col"; ratio: number; children: [Cell, Cell] };
```

**Reordering sections is reordering, not positioning** — splice the new index
into `sort_order`. This is what avoids the "block landed somewhere other than
where I dropped it" failure that auto-packing layouts (masonry, dense flow) all
have.

### The mobile problem, and the fix

A recursive split tree is a desktop tiling paradigm and this is a mobile-first
PWA. On a 390px phone a 50/50 row split gives two 190px columns; split one again
and you have 95px, which fits no block this product has. v1's grid clamped
spans at 2 columns precisely because of this. The split tree needs an equivalent
and it must not be a second stored layout.

**Container queries, not JavaScript measurement.** Each split renders as a flex
container whose PANES are the containment contexts, and collapses to stacked when
the space it was given can't carry two children:

```css
/* THE CONTAINMENT GOES ON THE PANES, NOT THE SPLIT. An element cannot
   container-query itself: with `container-type` on `.cell-split`, its own
   @container rule resolves against the next container UP the tree, so a nested
   split would collapse based on some unrelated ancestor's width. Each pane is a
   container, so the split inside it queries the space it was actually given.
   `.site-bento` provides the same for the root split, which has no pane above
   it. (v2 of this spec had this wrong; the implementation is correct.) */
.site-bento,
.cell-pane { container-type: inline-size; min-width: 0; }

.cell-split { display: flex; gap: 0.75rem; }
.cell-split[data-dir="row"] { flex-direction: row; }
.cell-split[data-dir="col"] { flex-direction: column; }

.cell-split[data-dir="row"] > .cell-pane { flex: var(--ratio, 0.5) 1 0; }
.cell-split[data-dir="col"] > .cell-pane { flex: 0 0 auto; }

/* 21rem ≈ 336px — two 10rem panes plus the gap. Below that a row split cannot
   give either child a legible width. Resetting flex is not tidying: stacked,
   `flex: var(--ratio)` would divide HEIGHT and clip whichever block drew the
   short half. */
@container (width < 21rem) {
  .cell-split[data-dir="row"] { flex-direction: column; }
  .cell-split[data-dir="row"] > .cell-pane { flex: 0 0 auto; }
}
```

Children carry `flex: var(--ratio)` / `flex: calc(1 - var(--ratio))` in the row
state. The result: one stored tree, correct server-rendered HTML, no JS, and
collapse happens independently at every depth against real available width
rather than against a global breakpoint. A deeply-split tree degrades to a
readable single column on a phone automatically.

### Invariants the tree must hold

A JSONB blob cannot carry the CHECK constraints v1's `smallint` spans did, so
these are enforced in the write path (server action) and guarded again at render:

- **Depth ≤ 4** (max 16 leaves per section). Unbounded depth is both
  unrenderable and a cheap denial-of-service against our own renderer.
- **`ratio` clamped to [0.2, 0.8]**, stored to 3 decimals. Unclamped, a pane can
  be dragged to zero width and becomes unrecoverable in the editor.
- **Leaf set == the section's block set.** Two failure modes exist that v1 could
  not produce: a block row no cell references (invisible and undeletable through
  the UI) and a cell referencing a deleted block (dangling). Validate on write;
  at render, skip dangling refs and collapse rather than throwing.
- **The renderer is defensive.** `root_cell` is user-writable data. Recursion
  guards on depth and node count, and any malformed tree renders as the
  section's blocks in `sort_order` — degraded, never blank.

### Resolved: sibling behaviour on delete

**Auto-collapse the split back into the surviving child. Always.**

An empty pane is a dead end: there is no way to fill it except by adding a
block, so it persists as a hole on the public page and the user has to clean it
up manually. Collapsing also preserves the invariant that **every leaf is a
component**, which makes the renderer total — no empty-cell branch, no
placeholder styling, and no need to answer "what does an empty pane look like to
a visitor." That invariant is worth more than the flexibility. Undo restores the
split.

### Library

**The tree format is ours; the library is an editor-only implementation detail.**

- **Public renderer: no library at all.** A recursive server component over
  `Cell`, ~50 lines, zero client JS. The public page is the highest-traffic
  route in the app and must not ship an editor's dependency tree.
- **Editor: no layout library either — SUPERSEDED.** `react-resizable-panels`
  was the plan and was dropped during implementation. It owns its own layout
  model (panel groups, percentages) and renders its own DOM, so it would have to
  be kept in sync with the Cell tree that is already the source of truth, and the
  editor would stop looking like the page it edits. A pointer handler writing
  `--ratio` is ~40 lines, has no sync problem, and lets the editor reuse the
  public renderer's own classes — which is what makes the preview genuinely
  WYSIWYG, container-query collapse included.
- **Not `react-mosaic`.** It pulls `react-dnd` plus a DnD backend; the HTML5
  backend has no touch support, so a mobile editor needs `react-dnd-touch-backend`
  on top. That is a lot of bundle and a lot of desktop-windowing assumption for
  a phone-first editor.
- **Split by tap, not by drag.** A selected cell offers `⬍ split` / `⬌ split`
  buttons; resize is the drag. Drag-to-split is a poor gesture on touch anyway,
  and dropping it is what makes `react-resizable-panels` sufficient.

### Motion

`stack-scroll` is scroll-driven animation. Two rules, both consistent with
`globals.css`'s existing stance:

- Under `prefers-reduced-motion: reduce` it degrades to `single`.
- Built with `animation-timeline: view()` as **progressive enhancement** — where
  the engine doesn't support scroll-driven animations it is a plain stacked
  list, which is a correct page, not a broken one.

### Open: widget components as block types

Several React Bits components have been floated as inspiration — Profile Card,
Counter, Stepper, Circular Gallery, Card Swap. (`src/components/profile-card.tsx`
is already a React Bits port, so the precedent exists.)

**Recommendation: none of them become v1 block types. They become `display`
variants of existing types.** Circular Gallery is `gallery` with
`display: "circular"`; Card Swap is `gallery`/`work` with `display: "swap"`;
Profile Card is the `hero` block's existing treatment. Each new *type* costs a
content schema, an editor UI, validation, and an analytics surface — the scope
multiplier the resolutions doc correctly identified. A variant costs an enum
value and a renderer branch, and can be promoted to a real type later if usage
justifies it. Counter and Stepper don't map to profile content at all; they are
UI chrome and should stay out.

## S5. Blocks

Every block row is `{ id, section_id, type, content jsonb, sort_order,
visibility, created_at, updated_at }`. Size and position live in the section's
cell tree, not on the block. `content` is validated against a per-type schema on
write **and** shape-checked on read — a block that fails validation renders as
nothing rather than throwing, so one bad row can never take down a page.

`visibility ∈ { public, connections, private }`. `private` is a draft state
visible only to the owner in the editor.

### Identity & contact

| Type | Content | Notes |
|---|---|---|
| `hero` | `{ display, tagline, background }` | Name/photo from `profiles`. Not deletable. |
| `contact` | `{ show_phone, show_email, save_cta }` | Real values only to `connection`; "Scan to connect" otherwise. Values never enter a non-connection's payload — S9. |
| `links` | `{ items: [{ label, url, icon }] }` | Max 20. |
| `socials` | `{ items: [{ network, handle }] }` | URL built from a known-network table, never free-form. |
| `fields` | `{ field_ids: uuid[] }` | Renders existing `custom_fields`, honouring their own `is_public`. |

### Media & showcase

| Type | Content | Notes |
|---|---|---|
| `image` | `{ media_id, caption, fit }` | |
| `gallery` | `{ media_ids: [], display: grid\|carousel\|circular\|swap }` | 2–12 images. |
| `embed` | `{ provider, id }` | **Allowlist only** — YouTube, Vimeo, Spotify, SoundCloud, Cal.com. We store a provider enum and an id, never a URL and never markup, then build the iframe ourselves with `sandbox` + CSP. |
| `work` | `{ items: [{ title, media_id, blurb, url }], display }` | Max 12. |

### Long-form

| Type | Content | Notes |
|---|---|---|
| `text` | `{ doc: RichDoc }` | S6 — a constrained AST, never HTML. |
| `timeline` | `{ items: [{ title, org, from, to, blurb }] }` | Max 20. |
| `faq` | `{ items: [{ q, a }] }` | Max 20, `<details>`-based. |
| `quote` | `{ text, attribution, media_id }` | |

### Interactive & live

| Type | Content | Notes |
|---|---|---|
| `status` | `{ text, emoji, updated_at }` | The "now" line. Cheap to update, which is the point — it makes a page feel alive between real edits. Busts the cache tag on write. |
| `subscribe` | `{ headline, blurb, button_label }` | S10. |
| `booking` | `{ provider, url }` | Allowlisted hosts; button by default, embed opt-in. |
| `map` | `{ place_label, lat, lng, zoom }` | **City-level only** — coordinates rounded server-side before storage, and the precise value never reaches the browser. A contact app publishing someone's house to the open web is a safety incident, and "the user chose it" is not a defence when the picker made it easy. |
| `form` | `{ fields, notify }` | Submissions land in `notifications`. Needs S12's rate limits. |
| `guestbook` | `{ moderation: auto\|approve }` | **Connections only, owner approves before public.** Deferred — it is the one block that lets a third party put text on someone else's public page, and that needs the moderation queue first. |

## S6. Rich text without HTML

`text` blocks store a constrained document tree, not markup:

```ts
type RichDoc = { v: 1; nodes: RichNode[] };
type RichNode =
  | { t: "p" | "h2" | "h3"; c: RichSpan[] }
  | { t: "ul" | "ol"; items: RichSpan[][] };
type RichSpan = { s: string; b?: true; i?: true; href?: string };
```

Rendered by mapping nodes to React elements. There is no `dangerouslySetInnerHTML`
anywhere in the site renderer and no sanitiser to keep patched — the same
reasoning §3 gives for the vCard newline ban, applied one layer earlier. `href`
is scheme-checked (`https:` and `mailto:` only) at write and again at render.

## S7. Templates and themes

Kept separate, because they have different lifetimes. A template is applied once
and forgotten; a theme is switched repeatedly.

- **Template** = a starter set of sections, layouts, blocks and placeholder copy,
  plus a default theme. Applying one to a non-empty site is offered as "replace"
  or "append", never a silent merge.
- **Theme** = a validated token object on `sites.theme`:

```ts
type SiteTheme = {
  canvas: "yellow" | "paper" | "lilac" | "sky" | "lime" | "ink";
  accent: "lemon" | "bubble" | "lime" | "lilac" | "sky" | "coral";
  surface: "paper" | "glass";
  display: "lilita" | "outfit";
  corner: "brutal" | "pill" | "square";
  shadow: "hard" | "soft" | "none";
  texture: "grid" | "dots" | "none";
};
```

Applied as CSS custom properties on the site root, so a theme change is a
handful of variables rather than a re-render of block internals. Every
combination is legible by construction because every value maps to a palette
entry whose contrast against ink is already documented.

If custom colour is ever wanted: accept a hex, run a WCAG contrast check against
ink and paper at save time, reject under 4.5:1. That is the only form of custom
colour that should ship. Not now.

Launch templates: **Professional**, **Creative**, **Founder**, **Student**,
**Link-in-bio**, **Minimal**.

## S8. Data model

```sql
create table sites (
  profile_id uuid primary key references profiles(id) on delete cascade,
  published boolean not null default false,
  template_id text,
  theme jsonb not null default '{}'::jsonb check (pg_column_size(theme) <= 2048),
  seo   jsonb not null default '{}'::jsonb check (pg_column_size(seo)   <= 2048),
  -- Separate from profiles.updated_at: this drives cache invalidation, not
  -- change notifications (S2).
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create type section_layout as enum ('bento', 'row-scroll', 'stack-scroll', 'single');

create table site_sections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(profile_id) on delete cascade,
  layout_type section_layout not null default 'single',
  -- The Cell tree (S4). Null for non-bento layouts, which order by the blocks'
  -- own sort_order. Size-capped because depth is capped: 16 leaves cannot
  -- legitimately produce a large document.
  root_cell jsonb check (root_cell is null or pg_column_size(root_cell) <= 8192),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on site_sections (site_id, sort_order);

create type block_visibility as enum ('public', 'connections', 'private');

create table site_blocks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references site_sections(id) on delete cascade,
  type text not null,
  content jsonb not null default '{}'::jsonb check (pg_column_size(content) <= 16384),
  -- Ordering WITHIN a section for non-bento layouts, and the degraded-render
  -- fallback order for a malformed bento tree (S4).
  sort_order int not null default 0,
  visibility block_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on site_blocks (section_id, sort_order);

create table site_media (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  public_id text not null,          -- Cloudinary
  width int, height int, bytes int,
  created_at timestamptz not null default now()
);
create index on site_media (profile_id);

create table handle_history (
  handle citext primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  released_at timestamptz not null default now()
);
```

`profiles` gains `handle citext unique not null` plus reserved-word and format
CHECKs. `site_media` exists so uploads can be quota-counted and orphans swept by
the existing retention job (§8) — a `media_id` buried in a `content` blob is not
something a cleanup query can find.

### Tier columns, unenforced

Per resolution 1: shaped now, read by nothing.

```sql
alter table profiles add column tier text not null default 'free'
  check (tier in ('free', 'trial', 'paid'));

-- Limits are per-TIER, not per-user, so they belong in a lookup rather than in
-- columns replicated across every profile row. Editable later without a
-- migration; the nullable override column covers comps and grandfathering.
create table tier_limits (
  tier text primary key,
  max_sections int,
  max_blocks int,
  media_allowed boolean not null default true,
  email_list_allowed boolean not null default true,
  analytics_level text not null default 'full'
);
alter table profiles add column limit_overrides jsonb;
```

Nothing checks these in phase 1. They exist because retrofitting a tier column
onto live data with real sites on it is a migration with downtime in it, and an
unread column costs nothing.

## S9. RLS and the security boundary

The first genuinely public read surface in the app; the existing policy set
assumes there is none.

1. **`sites`, `site_sections` and `site_blocks` get an anon-readable policy**,
   scoped to `published = true`, `visibility = 'public'`, and the owner not
   soft-deleted. `connections`-visibility blocks are excluded from that policy
   and read under a second, connection-gated policy — the same predicate shape
   `contact_details` already uses.
2. **`contact_details` gets no new policy.** The `contact` block renders real
   values only from a connection-gated read. If that read returns nothing the
   block renders its "scan to connect" state. The value never enters the
   cacheable payload, so no cache key can leak it.
3. **Blocking, and what it can and cannot do.**

### Blocking — implemented differently from resolution 5

The resolution says to render the blocked state via "the same PPR dynamic-slot
mechanism." **That mechanism cannot do this job.** PPR streams a static shell
first and fills dynamic slots after. If the shell contains the profile, it has
already painted by the time a slot could discover the viewer is blocked — there
is no retracting it. A dynamic slot can *add* gated content to a public shell;
it cannot *subtract* public content.

So the check moves upstream of the render, which S12's shape makes natural: the
route is dynamic, it resolves the viewer first, and only then does it render the
cached site component. Concretely:

```
/u/{handle}:
  1. read session (cookie)                     ← dynamic, per request
  2. if signed in: one indexed lookup against the owner's block list
  3. if blocked   → render blocked state, return
  4. otherwise    → render <CachedSite handle> ← shared cache, S12
```

Step 2 runs only when a session cookie is present, so the anonymous majority
costs nothing.

**The ceiling is real and stays.** Signed out, or from an account not on the
block list, the page is fully public — there is no auth wall on a public URL to
check against. This is structural to any public-URL product, not a gap to close.

Because of that, the blocking UI needs an honest line: not "you're now invisible
to them," but **"they won't see this while signed in — your page is still a
public link."** Users will otherwise assume the stronger guarantee.

## S10. Email list — collection only

Per resolution 2. **Collect, store, export. No sending, no confirmation, no
double opt-in, and therefore no transactional email provider — that dependency
is removed from the plan entirely.**

```sql
create table site_subscribers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(profile_id) on delete cascade,
  email citext not null,
  source text,
  created_at timestamptz not null default now()
);
create unique index on site_subscribers (site_id, email);
```

Note what is gone versus v1: `confirmed_at`, `unsubscribed_at`, `token`. Keeping
a `confirmed_at` that nothing ever sets would imply a consent state the product
does not have.

What ships:

- Format validation on submit.
- **Rate limits carry the whole load here.** With no confirmation step there is
  nothing downstream to filter junk, so the endpoint is limited per IP at the
  edge (`rate-limit-edge.ts`) and per site in `rate_events`, plus a honeypot
  field. This is the only defence the list has.
- CSV export for the owner.
- Owner gets a `new_subscriber` notification through the existing push pipeline.
  Unlike page views this is consented contact, so surfacing it by identity is
  fine.

**Recorded for whoever builds sending:** these addresses are captured without
confirmation, so this list cannot lawfully be mailed as-is. Sending would
require consent re-collected at that point — and sending is its own product
(deliverability, DMARC, abuse handling, sender identity), not an extension of
having a subscribers table.

## S11. Analytics — aggregate only

Consistent with the existing posture: `contact_saves` is deliberately unreadable
by its subject, and "who viewed your page" is that same signal at higher
resolution. **Viewer identity is never stored.** Not hashed-but-reversible, not
"only for connections" — never stored.

### Identity-free uniques

```
visitor_hash = sha256(daily_salt || site_id || ip || user_agent)[0:16]
```

`daily_salt` rotates at UTC midnight and is never persisted, so yesterday's
hashes cannot be re-derived even with raw logs. `site_id` in the input means one
visitor across two sites produces unlinkable hashes. The IP is used and
discarded in the same expression — never written to a column. This is the
Plausible/Fathom construction and it is what makes the feature defensible
without a cookie banner.

### Ingestion at scale

At 100k MAU a per-event insert is the most expensive write path in the product.

- **One beacon per session, not per event.** The client accumulates block taps
  and furthest section reached, then fires a single `navigator.sendBeacon` to
  `POST /api/site/event` on `visibilitychange`. A ten-block page with three taps
  costs one row, not five.
- Edge rate limit via `src/lib/rate-limit-edge.ts`.
- `site_events` is raw, RLS-on with **zero policies** (same as `rate_events` —
  reading it would be an oracle), retained **7 days**.
- A new cron worker rolls raw events into `site_stats_daily` and
  `site_block_stats_daily`, then drops what it consumed. Follows the existing
  `/api/worker/*` batched-with-advisory-lock pattern; add a third entry to
  `vercel.json`.
- The analytics page reads **only** rollups, never raw events.

### What gets shown

Every number keeps a next step attached, matching the existing page's rule that
vanity totals were left out.

- Views and uniques, 30d, on the existing `WeeklyChart`.
- **Source split** — QR scan / direct / search / social / referral. Answers "is
  the printed card working, or is this all people I already met."
- **Top blocks by taps**, and tap rate against impressions.
- **Section reach** — how far down the section list people get, and within a
  `row-scroll` section how far across. This replaces v1's "read depth", which
  assumed a single linear grid; sections give a cleaner unit anyway. Directly
  actionable: move the section nobody reaches.
- **Conversion** — views → connections, views → contact saves, views →
  subscribers.
- **"Worth doing something about"** gains site rows: blocks with zero taps in 30
  days, a page unpublished for a week, images over a size budget.

Block impressions come from one `IntersectionObserver` over the rendered blocks,
which handles `row-scroll`'s off-screen-to-the-right case for free.

The existing privacy footnote gains a sentence: page views are counted without
identifying who viewed. Stated on the page, not buried in a policy.

## S12. Caching and rendering

Per resolution 3, the full `cacheComponents` migration happens **now**, while
there are few routes to regress. That decision stands. One correction and one
consequence.

### Correction: the migration risk is the opposite of what was written

Resolution 3 warns that a route reading `cookies()` or `headers()` "needs an
explicit opt-in to dynamic rendering under the new default, or it silently gets
cached when it shouldn't."

That is backwards. From the migration guide
(`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`):
**"All pages are dynamic by default."** `dynamic = "force-dynamic"` becomes
unnecessary; caching is what you opt into, with `use cache`. Nothing gets
silently cached, and no route reading cookies needs a dynamic opt-in.

What to actually watch for:

- **Route segment configs go first.** Remove `dynamic`, `revalidate`,
  `fetchCache`. They are replaced by `use cache` / `cacheLife`.
- **Dev surfaces uncached dynamic data as errors**, naming the code to fix. Let
  the errors drive the migration rather than auditing by hand.
- **`<Suspense>` boundaries are the real work.** Runtime data needs wrapping so
  the static shell has something to stream around. This is where the time goes.
- `generateStaticParams` and `generateMetadata` have their own steps in the
  guide — `/u/{handle}` has a dynamic param and needs metadata, so both apply.
- Existing `unstable_cache` and `fetch` caching keep working as a separate
  layer; nothing has to be converted in one pass.

### Consequence: cache the component, not the route

Because identity has to be resolved before anything paints (S9.3), `/u/{handle}`
is a **dynamic route wrapping a cached component**:

```tsx
async function CachedSite({ handle }: { handle: string }) {
  "use cache";
  cacheTag(`site:${handle}`);
  // …fetch site, sections, blocks, theme; render the tree
}
```

The route reads cookies, resolves the viewer, checks the block list, and then
renders `<CachedSite>`. The expensive half — the DB reads and the tree render —
is shared across every visitor to that handle. Per-request cost is a cookie read
plus, for signed-in viewers only, one indexed lookup.

Publishing, editing a block, or updating a `status` calls `revalidateTag`;
the editor uses `updateTag` for read-your-writes.

**What this gives up:** a fully static, CDN-served shell for anonymous traffic.
That is recoverable later without changing this design — `src/proxy.ts` already
runs on every request, so it can rewrite cookie-less requests for `/u/` to a
fully static variant and leave the gated route for signed-in viewers. Worth
doing if public traffic ever dominates; not worth doing before it does.

### While we are in proxy.ts

The current matcher covers everything, and the handler calls
`supabase.auth.getUser()` — a network round trip to Supabase — on **every**
matched request. Once `/u/{handle}` exists that fires on the highest-traffic,
mostly-anonymous route in the product, for visitors who have no session to
refresh. Add an early return when the request is for `/u/` and carries no
Supabase auth cookie. Cheap, and it keeps the public page off the auth path.

### Abuse

A public, indexable page anyone can fill with arbitrary content is a new abuse
surface. Three of these get skipped and then hurt:

- **Every user link gets `rel="nofollow ugc noopener noreferrer"`.** Without it
  we become an SEO link farm, and that is discovered by being delisted.
- **No page is indexable by default.** `noindex` until the profile clears a
  trust bar (photo + at least one connection). Otherwise the first thousand
  sign-ups are spam pages.
- **Strip EXIF on upload, unconditionally.** GPS, device and timestamp metadata
  are invisible in the image and fully extractable from the file — the `map`
  block's problem arriving by accident.
- Cloudinary caps: max upload size, fixed transform sizes, WebP/AVIF, never the
  original. §9 says this already and a gallery block multiplies it.
- Reports (§5.6) extend to sites: a `site_content` category plus a nullable
  `block_id`, and a report affordance reachable without an account.

## S13. Tiers — deferred

Per resolution 1: **no tier or pricing gating is enforced anywhere in this
phase.** The app is not in production, and gating the public page fights its job
as a growth-loop landing page. The schema shape lands now (S8); nothing reads
it.

The v1 tier table is withdrawn rather than restated — writing a limit matrix
nothing enforces invites someone to implement it from a stale document.

## S14. Open decisions

1. Editor entry point — a fifth tab-bar slot, or a card on `/profile`.
2. Custom domains. Real demand, real ops cost (cert issuance, verification).
   Out of scope; cheap to leave room for.
3. Does `/preview` survive? It answers "who sees what," which the editor's
   viewer-role toggle answers better. Likely folds in.
4. Whether any React Bits widget graduates from a `display` variant to a real
   block type (S4). Deliberately deferred until there is usage to point at.

## S15. Build order

1. **Handles + public route.** `profiles.handle`, reserved words,
   `handle_history`, `/u/{handle}` rendering today's profile card. **Does not
   depend on the layout engine** — start now, in parallel with finalising S4.
2. **`cacheComponents` migration.** Moved up from v1's step 8. Doing it against
   four or five routes is a different job from doing it against twenty, and step
   3 wants `use cache` to already exist.
3. **Sections + cells core.** `site_sections`, `site_blocks`, the recursive
   server renderer, the container-query collapse, tree validation, the viewer
   role model, and the identity/links/text blocks. Editor with tap-to-split and
   drag-to-resize. **Do not start until S4's schema is frozen** — unwinding a
   stale tree format costs more than the wait.
4. **Templates + themes.** Six templates, the token object, the switcher.
5. **Media + showcase.** Cloudinary pipeline, `site_media`, EXIF strip,
   `image`/`gallery`/`work`/`embed` allowlist.
6. **Analytics.** Beacon endpoint, `site_events`, rollup worker, cron entry, the
   new analytics section.
7. **Email capture.** Collection endpoint, rate limits, honeypot, CSV export.
8. **Interactive.** `form`, `booking`, `map`, then `guestbook` behind the
   moderation queue.
9. **Hardening.** `noindex` trust bar, nofollow, proxy early-return, load test
   the public route.

Steps 1–3 are the product. Everything after 4 is optional to a first release.

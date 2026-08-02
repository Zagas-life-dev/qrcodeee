# site-spec.md — Review Resolutions

Resolves the open points from the original spec review. Where a decision replaces something written in `site-spec.md`, that section needs a rewrite before layout-engine build work starts — not a patch.

**Status:** `site-spec.md` v2 incorporates every resolution below, so the rewrite gate is satisfied and step 3 is unblocked. This file stays as the decision record — the reasoning behind the calls, which the spec itself doesn't carry.

---

## 1. Tier gating — withdrawn, not restated

User tier/pricing gating is ignored for now — not enforced anywhere, and the v1 tier matrix is withdrawn from the doc entirely rather than left in as a stale reference nobody should implement from.

**Do now anyway:** tier columns land on the profile row per this resolution; limits themselves go in a separate `tier_limits` lookup table rather than being replicated per profile row, so turning gating on later is a lookup change, not a migration.

---

## 2. Email list — collection only

Scope is collect + store + export. No sending, no confirmation step, no consent flow.

**Consequence:** no transactional email provider (Resend/Postmark) needed. `site_subscribers` drops `confirmed_at`, `unsubscribed_at`, and `token` — keeping columns nothing ever sets would imply a consent state the product doesn't actually have. Since there's no confirmation step downstream to filter junk, rate limits on the collection endpoint carry the entire load: format-validate on write, rate-limit the endpoint, nothing else.

---

## 3. Layout engine — replaces the Bento section entirely

**Structure:** Page → ordered list of **Sections** (`sort_order` applies here). Each Section has a `layout_type`:

- `bento` — grid of components via recursive splitting
- `row-scroll` — horizontal scroll, carousel/dock-style
- `stack-scroll` — vertical scroll-stack, cards pile as you scroll; degrades to `single` under `prefers-reduced-motion`, built as progressive enhancement over `animation-timeline: view()`
- `single` — plain full-width list

**Inside a `bento` Section:** no named sizes, no coordinates, no CSS Grid. A cell starts whole and can be **split** — horizontal or vertical — into two children, either of which can be split again. Split ratio is draggable and freeform, not fixed to preset fractions.

```
Section { id, sort_order, layout_type: "bento" | "row-scroll" | "stack-scroll" | "single", root_cell? }

Cell =
  { type: "component", block_id }
  | { type: "split", direction: "row" | "col", ratio: number, children: [Cell, Cell] }
```

**Mobile-first sizing — container queries, not a second tree.** A recursive split tree is a desktop tiling paradigm by default: a 50/50 row split on a 390px phone gives two 190px columns, and a second split puts a child at ~95px. Fix is CSS container queries, not JS measurement and not a separately stored mobile tree — each split is its own containment context (`container-type: inline-size`) and flips from row to stacked independently, against its own real width, when it can't carry two children. One tree, correct on first server-rendered paint, zero client JS required to get it right. Collapse threshold (roughly 260–320px is the usual range) is a design decision to make against real content, not an engineering one. `site-spec.md` pins `@container (max-width: 21rem)` (≈336px, derived from a 10rem minimum cell plus the gap) as a deliberately conservative starting value — just above the top of that range. Tuning it down means accepting narrower cells, which is exactly the call to make against real blocks rather than in advance.

**Editor library:** `react-resizable-panels` — nests 1:1 with `Cell`, real touch support, small. Splitting is a tap affordance, not drag. `react-mosaic` was considered and dropped: it pulls `react-dnd`, whose HTML5 backend has no touch support, and dropping drag-to-split is exactly what makes the lighter library sufficient (tap is the better touch gesture regardless).

**Public/read-only renderer:** no client library — a ~50-line recursive server component. This is the same shared renderer used across all four viewer roles from the original load-bearing call (`anonymous`, `stranger`, `connection`, `owner`) on every route that shows a site — `/u/{handle}`, `/connect/{token}`, `/connections/{profileId}`. It stays dependency-free because the highest-traffic route can't carry the editor's deps, not because it's a second renderer forking off from the interactive one.

**JSONB write-path invariants** (a JSONB tree can't carry the CHECK constraints simple `smallint` spans could): depth ≤ 4; ratio clamped to [0.2, 0.8] — unclamped, a pane can be dragged to zero width and becomes unrecoverable; leaf set must equal the Section's block set; a defensive renderer degrades a malformed tree to flat `sort_order` order rather than rendering blank.

**Sibling on delete — auto-collapse the split into the surviving child, always.** An empty pane is a dead end: nothing fills it except adding a block, so it persists as a hole on the published page and the user has to clean it up by hand. Collapsing also preserves the invariant that **every leaf is a component**, which makes the renderer total — no empty-cell branch, no placeholder styling, and no need to answer "what does a visitor see in an empty pane." That invariant is worth more than the flexibility. Undo restores the split.

**Widget components — `display` variants of existing block types, not new block types.** Circular Gallery is `gallery` with `display: "circular"`; Card Swap is `gallery`/`work` with `display: "swap"`; Profile Card is the `hero` block's existing treatment (`src/components/profile-card.tsx` is already a React Bits port, so the precedent is in the codebase). A new *type* costs a content schema, an editor UI, validation and an analytics surface — that's the scope multiplier. A variant costs an enum value and a renderer branch, and can be promoted to a real type later if usage justifies it. Counter and Stepper don't map to profile content at all — they're UI chrome and stay out.

This is what unblocks step 3: both items above were the reason it was gated.

---

## 4. Safety items — resolved

**Map coordinates:** round to city-level server-side before any public display.

**EXIF stripping:** strip automatically on upload, unconditionally.

**Blocked users and the public page:** blocked users must not see the blocking user's public page. Two-part, because `/u/{handle}` is intentionally public and unauthenticated by design:

1. **Enforceable:** while the blocked person is signed in, check their session against the profile owner's block list and render a blocked-state on a match.

   **Not via a PPR dynamic slot — that mechanism can't do this job.** PPR streams the static shell first and fills dynamic slots after; if the shell carries the profile, it has already painted by the time a slot could discover the viewer is blocked. A dynamic slot can *add* gated content to a public shell, it cannot *subtract* public content. So the check moves upstream of the render: the route is dynamic, resolves the viewer first, and only then renders a `use cache`'d site component tagged `site:{handle}`. The expensive half — DB reads and tree render — stays shared across every visitor to that handle; per-request cost is a cookie read plus, for signed-in viewers only, one indexed lookup. The cost of this is giving up a fully static CDN-served shell for anonymous traffic, which `proxy.ts` can recover later by rewriting cookie-less `/u/` requests to a static variant — worth doing if public traffic ever dominates, not before.
2. **Not enforceable:** logged out, or from an unrecognized account, there's no auth wall to check against — a structural ceiling of any public-URL product, not a gap to close. Blocking UI needs an honest line reflecting this, not a false guarantee of invisibility.

**Middleware performance:** `proxy.ts` calling `supabase.auth.getUser()` on every matched request is a network round trip on every hit — including the highest-traffic, mostly-anonymous `/u/{handle}` route. Early-return when no auth cookie is present; this doesn't conflict with the blocked-viewer check above, since that check only matters when a session cookie already exists.

---

## 5. Build order

1. **Handles + public route** — no dependency on the layout engine, starts now.
2. **`cacheComponents` migration** — moved here rather than done immediately or deferred to launch: against five routes today it's a different job than against twenty later, and the Sections/Cells work in step 3 wants `use cache` already in place.

   **The risk is the opposite of "routes reading `cookies()`/`headers()` need a dynamic opt-in."** Per `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`: *"All pages are dynamic by default."* `dynamic = "force-dynamic"` becomes unnecessary, caching is what you opt into via `use cache`, and nothing gets silently cached. What actually needs watching: remove the route segment configs (`dynamic`, `revalidate`, `fetchCache`) first; let dev-mode errors — which name the code to fix — drive the work rather than auditing by hand; and budget for `<Suspense>` boundaries, which are where the time goes. `generateStaticParams` and `generateMetadata` have their own steps in the guide, and `/u/{handle}` needs both.
3. **Sections/Cells core** — the layout-engine open items above are now settled, so this is unblocked. Schema freezes on `site-spec.md` S4/S8 before work starts; building against a stale tree format is more expensive to unwind than the wait.

Steps 4–9 (templates/themes, media, analytics, email capture, interactive blocks, hardening) are unchanged and live in `site-spec.md` S15 — this list covers only the ordering constraints that were actually in question.
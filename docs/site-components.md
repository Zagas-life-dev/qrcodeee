# React Bits → block library: adoption study

Companion to `site-spec.md`. Covers the fifteen components requested, and what
each one costs to put inside a Cell. Feeds steps **4** (templates + themes),
**5** (media + showcase) and **8** (interactive) of S15.

The site pages are JS-rendered, so the docs return an empty shell to a fetch.
Everything below is read from source at
`DavidHDev/react-bits@main:src/ts-tailwind/Components/<Name>/<Name>.tsx` —
the TypeScript + Tailwind variant, which is the one that matches this codebase.

---

## 1. Two constraints that decide most of this

### 1.1 The licence is MIT **plus a Commons Clause**

> You may use this Software, including for any commercial purpose, **so long as
> you do not sell, sublicense, or redistribute the components themselves** —
> whether alone, in a bundle, or as a ported version.

Using them inside this product is explicitly granted, commercially included.
Two things would cross the line, and both are plausible product directions, so
they are worth naming before anyone builds them:

- **An "export your page as code" feature.** That hands the component to the
  user. Don't build it against react-bits-derived blocks.
- **Putting react-bits-derived blocks behind the paywall as the paid artifact.**
  `tier_limits` and `profiles.tier` already exist. Gating *how many* blocks or
  *how much media* a tier gets is fine — that sells capacity. Gating *which
  components* you may use starts to look like selling the components. Keep the
  tier axis on quantity, not on component identity.

I'm not a lawyer and this clause is non-standard; if templates ever become the
thing being sold, it's worth a real opinion. Attribution costs nothing and is
worth adding regardless.

### 1.2 The public page currently ships zero client JavaScript

`SiteRender` → `CellRender` → `BlockRender` are server components, output cached
under `site:{id}`. Every component in this study is a client component. That is
not a blocker, but it changes the renderer's shape: **blocks become islands**,
and the shell stays server-rendered.

The rule that keeps this from becoming a bundle problem:

```tsx
// Only the block types actually present on a page get downloaded.
const Gallery = dynamic(() => import("./blocks/gallery"));
```

A typical page has three or four block types. Under per-block dynamic import,
carrying two animation libraries is fine; under a static barrel import it is
~80 KB gz on a personal page, most of it unused.

Weights, gzipped: `motion` ~34 KB · `gsap` ~23 KB · `lenis` ~7 KB · `ogl` ~14 KB.

**`motion@12.43.0` is already a dependency of this project.** Six of the fifteen
need nothing new.

---

## 2. Verdict table

| Component | Deps | Fits a Cell? | Verdict |
|---|---|---|---|
| **TiltedCard** | motion ✅ | yes | **Adopt** — the image block |
| **Masonry** | gsap ⚠️ | yes | **Adopt** — the gallery block |
| **ProfileCard** | none ✅ | yes | **Adopt** — the identity block |
| **Dock** | motion ✅ | yes | **Adopt** — socials, icon variant |
| **Counter** | motion ✅ | yes | **Adopt** — the stat block |
| **AnimatedList** | motion ✅ | yes | **Adopt** — the list block |
| **Stepper** | motion ✅ | n/a | **Adopt, editor only** — onboarding |
| **CardSwap** | gsap ⚠️ | with % sizing | **Later** — featured-work rotator |
| **Carousel** | motion ✅ | with % sizing | **Later** — overlaps CardSwap |
| **CardNav** | gsap ⚠️ | page-level | **Pick one of three** — section nav |
| **StaggeredMenu** | gsap ⚠️ | page-level | **Pick one of three** |
| **BubbleMenu** | gsap ⚠️ | page-level | **Pick one of three** |
| **OptionWheel** | none ✅ | it's an input | **Skip** — grid beats wheel here |
| **ScrollStack** | lenis ❌ | no | **Reimplement without Lenis** |
| **CircularGallery** | ogl ❌ | technically | **Skip as the default gallery** |

### The four that need argument

**CircularGallery renders to a WebGL canvas.** It is 825 lines of `ogl` that
uploads images as GPU textures and draws the captions from a generated font
atlas. There are no `<img>` elements, which means: no alt text, no lazy
loading, nothing for a crawler to index, no long-press-to-save on a phone, and a
blank box wherever WebGL is blocked or unavailable. On a personal site whose
entire purpose is being found and read by other people, that is the wrong
trade — the photos *are* the content. Masonry does the same job in real DOM.
Worth keeping as an opt-in "showcase" template later, behind a DOM fallback.

**ScrollStack instantiates Lenis**, which replaces the page's scrolling with a
JS-driven one. Inside an installed PWA on iOS that means fighting momentum
scroll, rubber-banding and the address-bar collapse, on every page that
contains the block — not just while it's on screen. The effect itself is worth
having and maps onto the existing `stacked` section layout, but it should be
built from `position: sticky` plus `animation-timeline: view()`, which is native,
scroll-linked off the main thread, and costs zero bytes. Chrome/Edge have it;
Safari and Firefox degrade to a plain stack, which is the correct fallback.

**Three of these are the same component.** CardNav, StaggeredMenu and BubbleMenu
are all "a fixed-position nav that opens". They differ in animation, not in
purpose, and shipping more than one is three gsap timelines for one job.
CardNav is the best fit: its `items: { label, bgColor, textColor, links[] }`
maps directly onto sections-with-links, and the card aesthetic is closest to
neo-brutalism. StaggeredMenu's `socialItems` is the one feature the others lack,
and it is ten lines to port.

**OptionWheel is an input, not a block** — an iOS-style picker wheel, zero deps.
The obvious use was the social-network picker. A 12-tile logo grid beats it:
every option is visible at once instead of three at a time, it needs no drag
gesture on a touch target that is also a scroll surface, and native radios give
keyboard and screen-reader behaviour for free. That grid is what shipped.

---

## 3. Five rules for anything adopted

These come out of the components' actual source, and each one is a real defect
if skipped.

**1. Take the motion, discard the skin.** These ship dark glassmorphism —
`#060010` backgrounds, backdrop blur, gradient glows, soft shadows. This app is
flat fills, 2px `--color-ink` borders, hard offset shadows, one light palette.
Pasting a component in unmodified doesn't add a component, it adds a second
design language. Keep the timing and the transforms; rewrite every colour and
shadow.

**2. No fixed pixel dimensions.** `TiltedCard` defaults `containerHeight: 300px`,
`Carousel` has `baseWidth: 300`, `CardSwap` has `width`/`height`, `Dock` has
`panelHeight`. A Cell is sized by its split ratios and can be any width. Every
one of these becomes `100%` or a `cqw`/`cqh` unit — `.cell-pane` already
establishes the container.

**3. Honour `prefers-reduced-motion`.** None of them do. `CardSwap` and
`Carousel` autoplay, `TiltedCard` and `ProfileCard` tilt in response to the
pointer, and continuous transform loops are a vestibular trigger. Gate at the
block wrapper so it is impossible to forget per-component.

**4. Delete the demo affordances.** `TiltedCard` has `showMobileWarning`, which
renders a literal "This effect is not optimized for mobile" banner —
default **on**. `Carousel` imports five `react-icons` glyphs purely for its demo
data. `CardNav` imports one arrow from `react-icons/go`; that is a 
whole icon package for one arrow.

**5. Every adoption is a fork, not an install.** react-bits distributes by
copy-paste (jsrepo), and the props are shaped for demos: `AnimatedList` takes
`items: string[]`, `Carousel` items carry an `icon` but no image. Our content is
parsed JSONB with a schema. Each component gets rewritten to take a
`BlockContent` — which is also the moment to delete the props we don't use.

---

## 3b. Build status

| Component | Block type | State |
|---|---|---|
| TiltedCard | `image` | **Built** — `TiltFrame` wraps server-rendered markup |
| Masonry | `gallery` | **Built, substituted** — CSS columns, see below |
| Counter | `stats` | **Built** |
| AnimatedList | `list` | **Built** |
| ProfileCard | `identity` | Not built — needs owner name/photo/bio threaded to `BlockRender` |
| Dock | socials variant | Not built |
| Stepper | editor onboarding | Not built |

**The pattern every built block follows: server component wrapping a client
one.** `ImageBlock` and `StatsBlock` are server components; only `TiltFrame` and
`Counter` are `"use client"`, and they receive server-rendered children. So the
`<img>`, its `srcset`, the caption and the true stat value are all in the
document — present for a crawler, for a reader with JS off, and on first paint.
Porting the originals wholesale would have moved all of that into the client
bundle, because upstream each component renders its own content.

**Masonry is the one substitution.** Upstream measures its container, computes
an (x, y, w, h) per item in JS, absolutely positions them and animates with gsap.
CSS multi-column produces the same picture with no gsap, no resize observer, no
post-hydration layout pass, and no absolutely-positioned divs for anything that
is not a browser. What it gives up is row-wise ordering — columns fill
top-to-bottom — which for photographs is not a cost. The staggered entrance is
kept as a CSS animation with a per-item delay, so it needs no JS either.

`prefers-reduced-motion` is handled once, in `use-reduced-motion.ts`, via
`useSyncExternalStore` with a server snapshot of `true` — the still answer is the
safe guess when the server cannot know.

## 4. Image support

Every adopted component that matters — TiltedCard, Masonry, ProfileCard — takes
a URL and, for Masonry, an intrinsic `height`. So the media pipeline is the
blocker for all of them, and it is step 5 in S15 regardless.

What the components force into the schema:

- **Intrinsic dimensions must be stored, not measured.** `Masonry`'s `items`
  are `{ id, img, url, height }` and it lays out from `height` before the images
  load. Cloudinary returns width/height on upload; store both on `site_media`.
  Measuring in the browser instead means a layout that jumps on every image.
- **Alt text is a first-class field**, not an afterthought — it is the entire
  argument against CircularGallery, so the DOM path had better honour it.
- **EXIF stripping stays non-negotiable.** A phone photo carries GPS. This is a
  page that publishes a person's location history if we let it.

Blocks this unlocks: `image` (TiltedCard), `gallery` (Masonry), `work`
(CardSwap/Carousel), `embed`.

### 4b. What shipped

**A block stores a bare UUID, never a URL or a path.** `mediaUrl()` rebuilds the
Cloudinary public_id from it plus the profile id the page was looked up by, so an
image block *cannot express* a reference to another account's asset — someone who
rewrites `content` through PostgREST to a stolen UUID gets a 404 under their own
folder. `parseImageRef` enforces bare-UUID shape for the same reason a path
segment always needs an allowlist: Cloudinary public_ids may contain slashes.

**EXIF is stripped in the browser, by mechanism rather than by enumeration.** The
image is decoded to pixels, drawn to a canvas and re-encoded, so GPS, capture
time and camera serial are gone because nothing but pixels survives — no tag list
to keep current. That matters more here than for an avatar: a personal page is
photographs of where someone lives and works, at a permanent public URL, and
"Cloudinary strips it on delivery" is a vendor default the original URL does not
honour. Orientation is the trap that comes with it — re-encoding discards
rotation too, so the source is decoded with `imageOrientation: "from-image"`.

**Two ceilings, at different layers.** The browser downscales to 2048px as a
courtesy to the user's data plan; a signed *incoming* transformation
(`c_limit,w_2048,h_2048`) is what actually bounds what Cloudinary stores when
somebody posts a 100MP TIFF at the signed endpoint with curl.

**The upload is not verified server-side, deliberately.** Cloudinary's response
goes to the browser, so dimensions are relayed by the client. Verifying would
cost an Admin API round trip per image to close "a user lies about their own
image's aspect ratio and skews their own layout". The two values where a lie
would matter are closed structurally instead: the media id is generated
server-side, and the folder comes from `auth.uid()`.

`w`/`h` feed `aspect-ratio`, which is what stops the page reflowing as images
arrive — the reason they are stored rather than measured.

---

## 5. Social logos — shipped

`SOCIAL_NETWORKS` is a closed set of twelve, which makes an icon package the
wrong shape: it would ship thousands of glyphs so we could use twelve, in the
render path of a page that is otherwise pure server HTML. Twelve inline paths in
`src/lib/site/social-icons.tsx` cost no dependency and no request, and render on
the server.

Three things worth recording:

**LinkedIn is not in Simple Icons.** They had it removed on trademark grounds,
so there is no public-domain source for the "in" mark. The removal was about
redistribution *as part of an icon library*; using the mark as the label on a
link that goes to LinkedIn is nominative use, which is what every social-links
product on the web does. The path is carried directly, and `SocialIcon` falls
back gracefully if it is ever pulled.

**WhatsApp's brand green fails contrast.** `#25D366` scores **1.95:1** against
`--color-paper`. The entry uses `#128C7E` — WhatsApp's own darker green — at
4.07:1. A test asserts ≥3:1 for all twelve, so this can't silently regress.

**Mark *and* name, not mark alone.** Icon-only chips have to carry the meaning
themselves, which needs an accessible name bolted on, a contrast ratio they
can't all reach, and a viewer who recognises twelve silhouettes. Marks are
`aria-hidden` beside the network name in text.

Colour is on the **glyph**, not the chip background. Twelve arbitrary brand
colours behind ink text is twelve contrast problems; on a paper chip it is one
that a test can check.

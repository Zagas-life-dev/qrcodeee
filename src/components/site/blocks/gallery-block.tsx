import { mediaSrcSet, mediaUrl } from "@/lib/site/media";
import type { GalleryContent } from "@/lib/site/blocks";
import type { SiteOwner } from "@/lib/site/read";

/**
 * A masonry gallery (site-spec S6).
 *
 * THIS IS THE ONE PLACE I DID NOT PORT THE REACT-BITS COMPONENT, and the reason
 * is worth stating rather than burying. Upstream `Masonry` measures its
 * container, computes an (x, y, w, h) for every item in JavaScript, absolutely
 * positions them, and animates each into place with gsap. That buys precise
 * row-wise balancing — and costs a gsap dependency, a resize observer, a layout
 * pass that cannot begin until after hydration, and a gallery that is a stack of
 * absolutely-positioned divs to anything that is not a browser.
 *
 * CSS multi-column produces the same picture with none of that. It is laid out
 * by the time the HTML arrives, it reflows on resize for free, and it degrades
 * to a single column with no code. What it gives up is ordering: columns fill
 * top-to-bottom, so reading order is down each column rather than across. For a
 * set of photographs, which have no reading order, that is not a cost.
 *
 * The entrance stagger is kept — as a CSS animation with a per-item delay, so
 * it needs no JavaScript either, and `prefers-reduced-motion` turns it off in
 * globals.css rather than in a hook.
 *
 * `aspect-ratio` from the stored dimensions is load-bearing here: without it,
 * every image that arrives would change the height of its column and shuffle
 * everything below it. That is why `w`/`h` are stored rather than measured.
 */
export function GalleryBlock({
  content,
  owner,
}: {
  content: GalleryContent;
  owner: SiteOwner;
}) {
  return (
    // The frame exists only to be a containment context. An element cannot
    // container-query itself, and in a `stacked` section there is no
    // `.cell-pane` above to query — so without this the column count would be
    // stuck at its 2-column default everywhere outside a bento layout.
    <div className="site-gallery-frame">
      <ul className="site-gallery">
        {content.items.map((image, index) => (
          <li
            key={image.id}
            className="site-gallery-item"
            // Capped at eight steps so a twelve-image gallery does not take two
            // seconds to finish arriving.
            style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- see image-block.tsx */}
            <img
              src={mediaUrl(owner.id, image.id, image.v, 400)}
              srcSet={mediaSrcSet(owner.id, image.id, image.v)}
              // Columns are ~150–260px wide in practice, so even on a wide
              // desktop pane the 400px file is usually the right one.
              sizes="(max-width: 640px) 45vw, 260px"
              alt={image.alt}
              width={image.w}
              height={image.h}
              loading="lazy"
              decoding="async"
              className="sk-surface w-full object-cover"
              style={{ aspectRatio: `${image.w} / ${image.h}` }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

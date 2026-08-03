import { mediaSrcSet, mediaUrl } from "@/lib/site/media";
import type { ImageContent } from "@/lib/site/blocks";
import type { SiteOwner } from "@/lib/site/read";

import { TiltFrame } from "./tilt-frame";

/**
 * One image (site-spec S6).
 *
 * A SERVER COMPONENT WRAPPING A CLIENT ONE, which is the arrangement that keeps
 * the picture in the document. `TiltFrame` is the only part that needs the
 * browser; the `<img>`, its `srcset` and its caption are server-rendered
 * children passed through it. So the image is present for a crawler, for a
 * reader with JS disabled, and on the first paint before hydration — none of
 * which would be true if the whole block were a client component that renders
 * its own `<img>` the way react-bits' TiltedCard does.
 *
 * `aspect-ratio` from the stored dimensions is what stops the page reflowing as
 * images arrive. It is why `w`/`h` are in the block content at all.
 */
export function ImageBlock({
  content,
  owner,
}: {
  content: ImageContent;
  owner: SiteOwner;
}) {
  const { image, caption } = content;

  return (
    <TiltFrame className="h-full">
      <figure className="sk-surface flex h-full flex-col overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image would
            re-proxy an asset Cloudinary has already sized, cached and served
            from its own CDN, and bill us for the transfer a second time. The
            srcset below is what next/image would have generated. */}
        <img
          src={mediaUrl(owner.id, image.id, image.v, 800)}
          srcSet={mediaSrcSet(owner.id, image.id, image.v)}
          // A bento cell is at most the full band and often a quarter of it.
          // Without this the browser assumes 100vw and picks the 1600px file
          // for a pane 200px wide.
          sizes="(max-width: 640px) 100vw, 50vw"
          alt={image.alt}
          width={image.w}
          height={image.h}
          loading="lazy"
          decoding="async"
          className="min-h-0 w-full flex-1 object-cover"
          style={{ aspectRatio: `${image.w} / ${image.h}` }}
        />
        {caption ? (
          <figcaption className="sk-rule-t sk-muted px-[0.75em] py-[0.5em] text-[0.75em] font-medium">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </TiltFrame>
  );
}

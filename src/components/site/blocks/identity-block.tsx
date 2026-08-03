import { avatarUrl } from "@/lib/site/avatar";
import type { IdentityContent } from "@/lib/site/blocks";
import type { SiteOwner } from "@/lib/site/read";

import { TiltFrame } from "./tilt-frame";

/**
 * The identity card — react-bits `ProfileCard`, adapted (site-spec S5).
 *
 * THE CONTENT IS NOT IN THE BLOCK, and that is the whole design. Upstream takes
 * `name`, `title`, `handle` and `avatarUrl` as props; here only the TAGLINE is
 * stored, and the name, photo and handle come from the profile. Copying them
 * into block content would mean someone changing their name in the app and
 * their own page still saying the old one — with no indication of which is
 * authoritative and no way to find the stale copies later.
 *
 * WHAT ELSE CHANGED FROM UPSTREAM:
 *
 * - **The holographic gradient layers are gone.** They are six stacked
 *   `background-image`s tuned for one dark palette; under `minimal` or `skeu`
 *   they are a different design language sitting in the middle of the page.
 *   The card takes the skin's own surface instead, so it belongs to whichever
 *   look its owner picked.
 * - **The tilt is `TiltFrame`**, already written for the image block, so
 *   reduced-motion and the touch fallback are handled in one place rather than
 *   in a second 646-line implementation of the same effect.
 * - **`onContactClick` is gone.** Upstream's card has a "Contact" button; ours
 *   must not, because the real Save-contact affordance lives outside the themed
 *   area on purpose (see the note in globals.css). A second, page-styled button
 *   that looks like it saves a contact is precisely the thing that boundary
 *   exists to prevent.
 */
export function IdentityBlock({
  content,
  owner,
}: {
  content: IdentityContent;
  owner: SiteOwner;
}) {
  const photo = owner.photoUrl ?? avatarUrl(owner.id);

  return (
    <TiltFrame className="h-full" amplitude={8}>
      <article className="sk-surface flex h-full flex-col items-center gap-[0.5em] p-[1.25em] text-center">
        {photo ? (
          // The avatar is already sized and cropped by its Cloudinary
          // transform chain; see image-block.tsx for the full argument.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            width={128}
            height={128}
            loading="lazy"
            decoding="async"
            className="size-[4em] rounded-full border-2 border-current object-cover"
          />
        ) : null}

        <div>
          <h2 className="text-[1.25em] leading-tight font-bold">{owner.name}</h2>
          {content.tagline ? (
            <p className="mt-[0.25em] text-[0.875em] font-medium">{content.tagline}</p>
          ) : null}
          {/* The handle is the one piece of identity a stranger can act on —
              it is what they type to come back — so it is shown even though the
              page they are reading is already at that address. */}
          <p className="sk-muted mt-[0.25em] font-mono text-[0.75em]">@{owner.handle}</p>
        </div>

        {owner.bio ? (
          <p className="text-[0.875em] font-medium text-pretty">{owner.bio}</p>
        ) : null}
      </article>
    </TiltFrame>
  );
}

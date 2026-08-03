/**
 * Every outbound link on a public profile carries these, and it is not
 * boilerplate (site-spec S12):
 *
 *   nofollow ugc — without it we are a free do-follow link farm, and the way
 *                  that gets discovered is by being delisted.
 *   noopener     — a target=_blank page can otherwise reach back through
 *                  window.opener and navigate this tab somewhere else.
 *   noreferrer   — the visitor's presence on someone's profile is not ours to
 *                  announce to whatever they clicked through to.
 *
 * Extracted from `block-render.tsx` so the client-side block components share
 * the one definition. A second copy is a second thing to forget.
 */
export const USER_LINK_REL = "nofollow ugc noopener noreferrer";

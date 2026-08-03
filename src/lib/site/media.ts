/**
 * Site image delivery (site-spec S6).
 *
 * THE ONE STRUCTURAL PROPERTY WORTH UNDERSTANDING: a block never stores a URL,
 * or even a full Cloudinary public_id. It stores a bare UUID, and the path is
 * rebuilt here from `profileId` — which the renderer already knows, because it
 * is what it looked the page up by. So an image block CANNOT reference another
 * account's asset. Not "is validated not to" — cannot express it. Someone who
 * edits `content` through PostgREST to point at a stolen UUID gets a 404 under
 * their own folder.
 *
 * That is the same narrowing `SOCIAL_NETWORKS` makes: the stored value is an
 * identifier, and the dangerous half of the string is ours to build.
 *
 * ISOMORPHIC. `BlockRender` runs in the public server renderer AND inside the
 * client editor, so this file cannot import anything server-only. The cloud
 * name is public by construction — it appears in every delivery URL a browser
 * fetches — hence the NEXT_PUBLIC_ prefix. Signing stays in `cloudinary.ts`.
 */

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

/** Longest edge we ever store. The client downscales to this before upload. */
export const MAX_STORED_EDGE = 2048;

/** Cloudinary's own ceiling, applied to whatever actually arrives (see below). */
export const INCOMING_TRANSFORM = `c_limit,w_${MAX_STORED_EDGE},h_${MAX_STORED_EDGE},q_auto`;

export function siteMediaFolder(profileId: string): string {
  return `qr-connect/sites/user_${profileId}`;
}

export function siteMediaPublicId(profileId: string, mediaId: string): string {
  return `${siteMediaFolder(profileId)}/${mediaId}`;
}

/**
 * Delivery widths. Not a continuous range: each distinct transformation string
 * is a separate derived asset that Cloudinary generates and stores, so an
 * arbitrary `w_${containerWidth}` would mint a new derivative per viewport.
 */
export const MEDIA_WIDTHS = [400, 800, 1600] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

/**
 * `c_limit` never enlarges and never crops — it bounds the long edge and leaves
 * the aspect ratio alone. Cropping belongs to CSS here, because the block knows
 * its shape and the URL does not.
 */
export function mediaUrl(
  profileId: string,
  mediaId: string,
  version: number,
  width: MediaWidth = 800,
): string {
  return [
    `https://res.cloudinary.com/${CLOUD_NAME}`,
    "image/upload",
    `f_auto,q_auto,c_limit,w_${width}`,
    `v${version}`,
    siteMediaPublicId(profileId, mediaId),
  ].join("/");
}

/**
 * `srcset` across the three widths, so a phone in a two-column bento grid does
 * not download the 1600px file. `sizes` is the caller's job — only the block
 * knows how wide its cell is.
 */
export function mediaSrcSet(profileId: string, mediaId: string, version: number): string {
  return MEDIA_WIDTHS.map(
    (w) => `${mediaUrl(profileId, mediaId, version, w)} ${w}w`,
  ).join(", ");
}

export function isMediaConfigured(): boolean {
  return Boolean(CLOUD_NAME);
}

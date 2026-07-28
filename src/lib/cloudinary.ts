import { createHash } from "node:crypto";

/**
 * Cloudinary signed direct upload (§2).
 *
 * The browser uploads straight to Cloudinary rather than through us. Proxying
 * would put every avatar through a serverless function with a 4.5MB body cap and
 * bill us for the bandwidth twice, for no benefit — the API secret never needs
 * to be in the request path, only in the signature.
 *
 * SERVER ONLY. CLOUDINARY_API_SECRET has no NEXT_PUBLIC_ prefix, so importing
 * this into a Client Component fails at build rather than shipping the secret.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

/**
 * One deterministic public_id per user. Two consequences, both wanted:
 * re-uploading overwrites in place instead of accumulating orphaned originals,
 * and the id is fully derivable from `auth.uid()` — so the client never gets to
 * choose where its upload lands.
 */
export function avatarPublicId(userId: string): string {
  return `qr-connect/avatars/user_${userId}`;
}

/**
 * Delivery URL, built server-side from the user id we already trust.
 *
 * The transformation chain is not decoration — §9 requires we never serve
 * full-resolution originals to every profile viewer:
 *   f_auto  → WebP/AVIF where the browser supports it
 *   q_auto  → per-image quality
 *   c_fill,g_face,w_256,h_256 → fixed delivery size, cropped around the face
 *
 * `v<version>` is what makes overwrite-in-place safe: same public_id, new
 * version, so a cached old avatar can't survive a change.
 */
export function avatarUrl(userId: string, version: number): string {
  return [
    `https://res.cloudinary.com/${CLOUD_NAME}`,
    "image/upload",
    "f_auto,q_auto,c_fill,g_face,w_256,h_256",
    `v${version}`,
    avatarPublicId(userId),
  ].join("/");
}

export type SignedUpload = {
  cloudName: string;
  apiKey: string;
  publicId: string;
  timestamp: number;
  signature: string;
  uploadUrl: string;
};

/**
 * Signs an avatar upload for one specific user.
 *
 * Every parameter that constrains WHERE the upload goes is inside the signature,
 * so the browser can't retarget it: Cloudinary recomputes the hash over the
 * params it receives and rejects any mismatch. A client that rewrites public_id
 * to overwrite somebody else's avatar invalidates the signature.
 */
export function signAvatarUpload(userId: string): SignedUpload {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error(
      "Cloudinary is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
    );
  }

  const params: Record<string, string> = {
    invalidate: "true", // purge the CDN copy of the previous avatar
    overwrite: "true",
    public_id: avatarPublicId(userId),
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  // Cloudinary's scheme: params sorted by key, joined as k=v with &, then the
  // API secret appended directly, SHA-1 hex.
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const signature = createHash("sha1").update(toSign + API_SECRET).digest("hex");

  return {
    cloudName: CLOUD_NAME,
    apiKey: API_KEY,
    publicId: params.public_id,
    timestamp: Number(params.timestamp),
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
  };
}

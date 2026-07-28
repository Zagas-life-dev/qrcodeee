/**
 * Fetches a profile photo and returns it base64-encoded for embedding in a
 * vCard (§5.2).
 *
 * SERVER ONLY — it makes an outbound request per card.
 *
 * ── Why embedding is required rather than nicer ────────────────────────────
 *
 * A `PHOTO;VALUE=URI:` line asks the importer to go and fetch the image. iOS
 * and Android importers do not: they import the card and drop the photo, which
 * is why avatars have never appeared on saved contacts. The bytes have to be
 * INSIDE the card.
 *
 * ── On fetching a URL out of the database ──────────────────────────────────
 *
 * Normally an SSRF concern. Here `profiles.photo_url` carries a CHECK
 * constraint pinning it to our own Cloudinary cloud or googleusercontent.com
 * (see 20260727130000_constrain_photo_url_host.sql), so the host is not
 * attacker-selectable. The allowlist is re-asserted below anyway: this file
 * would otherwise be one dropped constraint away from being a request forwarder,
 * and the check is three lines.
 */

/** Mirrors the DB CHECK constraint. Anchored, so `googleusercontent.com.evil.test` cannot match. */
const ALLOWED = [
  /^https:\/\/res\.cloudinary\.com\/djm0gwdv\/image\/upload\//,
  /^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com\//,
];

/**
 * Contacts apps understand JPEG and PNG. They do not understand WebP or AVIF,
 * which is exactly what Cloudinary's `f_auto` serves to a modern client — so an
 * embedded f_auto image imports as a broken photo rather than no photo.
 */
const TYPES: Record<string, "JPEG" | "PNG"> = {
  "image/jpeg": "JPEG",
  "image/jpg": "JPEG",
  "image/png": "PNG",
};

/**
 * A vCard is handed to an OS importer, not streamed — an oversized one fails
 * slowly and opaquely. The avatar transformation caps delivery at 256x256, so
 * anything past this is not a photo we generated.
 */
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 3000;

export type EmbeddedPhoto = { base64: string; type: "JPEG" | "PNG" };

export async function fetchPhotoForVCard(
  photoUrl: string | null | undefined,
): Promise<EmbeddedPhoto | null> {
  if (!photoUrl || !ALLOWED.some((pattern) => pattern.test(photoUrl))) return null;

  // f_auto negotiates WebP/AVIF from the Accept header and would embed a format
  // no address book can read. Pinning JPEG costs a little size and is the only
  // version of this that actually shows up on the contact.
  const url = photoUrl.replace(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/[^/]*?)f_auto/,
    "$1f_jpg",
  );

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "image/jpeg,image/png" },
    });
    if (!response.ok) return null;

    const type = TYPES[(response.headers.get("content-type") ?? "").split(";")[0].trim()];
    if (!type) return null;

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    // Re-checked after reading: content-length is a hint, and a missing one is
    // not a reason to accept an unbounded body.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    return { base64: Buffer.from(bytes).toString("base64"), type };
  } catch {
    // A slow or broken avatar host must cost the user their photo, never their
    // contact card — the caller omits PHOTO and builds the rest as normal.
    return null;
  }
}

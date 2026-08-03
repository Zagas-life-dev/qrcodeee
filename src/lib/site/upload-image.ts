import { MAX_STORED_EDGE } from "./media";
import { recordSiteMedia } from "./media-actions";
import type { ImageRef } from "./blocks";

/**
 * Browser-side image preparation and upload (site-spec S6).
 *
 * EXIF IS STRIPPED HERE, AND THE MECHANISM IS THE POINT. Nothing in this file
 * parses metadata or maintains a list of tags to remove. The image is decoded to
 * pixels, drawn to a canvas, and re-encoded — so what comes out is *only* the
 * pixels. GPS coordinates, capture time, camera serial, and whatever a future
 * phone decides to embed are all gone by construction, not by enumeration.
 *
 * That matters more here than for an avatar. A personal page is a set of photos
 * of where someone lives, works and spends their time, published at a permanent
 * public URL. Shipping the originals would publish their location history as a
 * side effect of publishing their page, and "Cloudinary strips it on delivery"
 * is a vendor default that our threat model should not be resting on — the
 * original stays fetchable at its own URL.
 *
 * ORIENTATION IS THE TRAP. EXIF also carries rotation, and re-encoding discards
 * it, so a portrait phone photo comes back sideways unless the source is decoded
 * with orientation already applied. `createImageBitmap(..., {imageOrientation})`
 * does that where supported; the `<img>` fallback relies on `image-orientation:
 * from-image` being the CSS default, which is where every current browser
 * landed.
 */

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * No GIF. Canvas re-encoding flattens an animation to its first frame, and
 * silently turning someone's animation into a still is worse than declining it.
 */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export type PreparedImage = { blob: Blob; width: number; height: number; preview: string };

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 25MB.`,
    );
  }

  const source = await decode(file);
  const scale = Math.min(1, MAX_STORED_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn't process that image.");
  context.drawImage(source.image, 0, 0, width, height);
  if ("close" in source.image) source.image.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    // WebP rather than JPEG: it keeps alpha, so a PNG logo does not gain a
    // black background on the way through, and it is smaller at equal quality.
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) throw new Error("Your browser couldn't process that image.");

  return { blob, width, height, preview: canvas.toDataURL("image/webp", 0.5) };
}

async function decode(
  file: File,
): Promise<{ image: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Safari before 16.4 rejects the options argument outright. Falling through
    // to an <img> is not a degraded path for orientation — browsers apply EXIF
    // rotation when rendering one — only for memory, since the full-size
    // decode stays live until the element is dropped.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { image, width: image.naturalWidth, height: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Prepare → sign → upload → record. Returns the reference a block stores.
 *
 * The signature is fetched AFTER preparation rather than in parallel with it.
 * A signature is a timestamped grant to write into the account's folder, and
 * preparing a large image can take seconds on a phone — starting the clock
 * before the work means the slowest uploads are the ones that expire.
 */
export async function uploadSiteImage(file: File): Promise<ImageRef> {
  const prepared = await prepareImage(file);

  const signResponse = await fetch("/api/site-media/sign", { method: "POST" });
  if (!signResponse.ok) {
    const body = await signResponse.json().catch(() => ({}));
    throw new Error(body.error ?? "Couldn't start the upload.");
  }
  const signed = await signResponse.json();

  const form = new FormData();
  form.append("file", prepared.blob);
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("public_id", signed.publicId);
  // Must match the signed value exactly — Cloudinary recomputes the hash over
  // what it receives, so a transformation added or dropped here fails the upload
  // rather than silently storing something unbounded.
  form.append("transformation", signed.transformation);

  const upload = await fetch(signed.uploadUrl, { method: "POST", body: form });
  const result = await upload.json();
  if (!upload.ok) {
    throw new Error(result?.error?.message ?? "Cloudinary rejected the upload.");
  }

  const recorded = await recordSiteMedia(
    signed.mediaId,
    Number(result.version),
    // Cloudinary's own numbers, not ours: the incoming `c_limit` may have
    // resized again, and the aspect hint has to describe what is stored.
    Number(result.width) || prepared.width,
    Number(result.height) || prepared.height,
  );
  if (!recorded.ok) throw new Error(recorded.message);

  return recorded.ref;
}

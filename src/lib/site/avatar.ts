/**
 * The owner's avatar URL, for the identity block.
 *
 * `profiles.photo_url` is already an absolute Cloudinary URL when a photo has
 * been uploaded, so this is only the fallback path: it rebuilds the same URL
 * from the user id, matching `avatarPublicId` in `lib/cloudinary.ts`.
 *
 * SEPARATE FROM `cloudinary.ts` BECAUSE THAT FILE IS SERVER-ONLY. It reads
 * CLOUDINARY_API_SECRET at module scope, and the identity block renders inside
 * the client editor as well as on the server — importing it there would fail
 * the build, which is exactly the guardrail that file documents.
 */
const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

export function avatarUrl(userId: string): string | null {
  if (!CLOUD_NAME) return null;
  return [
    `https://res.cloudinary.com/${CLOUD_NAME}`,
    "image/upload",
    "f_auto,q_auto,c_fill,g_face,w_256,h_256",
    `qr-connect/avatars/user_${userId}`,
  ].join("/");
}

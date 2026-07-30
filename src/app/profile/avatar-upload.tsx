"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { removePhoto, savePhoto } from "@/lib/profile/photo-actions";

/** Client-side guard only — a determined caller can skip it, which is fine:
 *  Cloudinary enforces its own account limits and the signature scopes the
 *  destination. This exists to give a fast, clear error for the common case. */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

type Props = { photoUrl: string | null; name: string };

export function AvatarUpload({ photoUrl, name }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown immediately from the local file so the change feels instant, rather
  // than waiting on the Cloudinary round trip plus a revalidate.
  const [preview, setPreview] = useState<string | null>(null);

  const busy = uploading || isPending;

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("Choose a JPEG, PNG, WebP, GIF or AVIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 5MB.`);
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const signResponse = await fetch("/api/avatar/sign", { method: "POST" });
      if (!signResponse.ok) {
        const body = await signResponse.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't start the upload.");
      }
      const signed = await signResponse.json();

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", signed.apiKey);
      form.append("timestamp", String(signed.timestamp));
      form.append("signature", signed.signature);
      form.append("public_id", signed.publicId);
      form.append("overwrite", "true");
      form.append("invalidate", "true");

      const upload = await fetch(signed.uploadUrl, { method: "POST", body: form });
      const result = await upload.json();
      if (!upload.ok) {
        throw new Error(result?.error?.message ?? "Cloudinary rejected the upload.");
      }

      // Hand back only the version — the server rebuilds the URL from the
      // session, so the browser never gets to say where its photo lives.
      const saved = await savePhoto(result.version);
      if (!saved.ok) throw new Error(saved.message);

      startTransition(() => router.refresh());
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove() {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const result = await removePhoto();
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  }

  const shown = preview ?? photoUrl;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-4">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-full border-2 border-ink bg-lilac shadow-brutal">
        {shown ? (
          // A blob: URL from the local file preview can't go through
          // next/image, and this element swaps between blob: and remote. The
          // remote form is already sized down by the Cloudinary transform chain
          // (w_256,h_256,f_auto,q_auto), which is what §9 actually asks for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="size-full object-cover" />
        ) : (
          <div
            aria-hidden
            className="flex size-full items-center justify-center font-display text-2xl"
          >
            {name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-[10px] font-bold text-paper">
            Saving…
          </div>
        ) : null}
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="min-h-11 rounded-brutal border-2 border-ink bg-lime px-4 text-sm font-bold shadow-brutal-sm nb-press-sm disabled:opacity-50"
          >
            {photoUrl ? "Change photo" : "Upload photo"}
          </button>
          {photoUrl ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleRemove}
              className="min-h-11 rounded-brutal border-2 border-ink bg-paper px-4 text-sm font-bold shadow-brutal-sm nb-press-sm disabled:opacity-40"
            >
              Remove
            </button>
          ) : null}
        </div>

        <p className="text-xs font-medium text-ink/70">
          Always public — anyone who opens your profile can see it. JPEG, PNG,
          WebP, GIF or AVIF, up to 5MB.
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-brutal border-2 border-ink bg-coral px-2.5 py-1.5 text-xs font-bold"
          >
            {error}
          </p>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

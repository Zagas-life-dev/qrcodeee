"use client";

import { useRef, useState } from "react";

import { mediaUrl } from "@/lib/site/media";
import { ACCEPTED_IMAGE_TYPES, uploadSiteImage } from "@/lib/site/upload-image";
import type { ImageRef } from "@/lib/site/blocks";
import type { SiteOwner } from "@/lib/site/read";

/**
 * Pick an image, upload it, hand back the reference (site-spec S6).
 *
 * Shared by the image and gallery forms, because "choose a file, wait, show a
 * thumbnail, report the failure" is the whole of both and is the part with the
 * states worth getting right.
 *
 * ALT TEXT SITS NEXT TO THE THUMBNAIL, NOT BEHIND AN "ADVANCED" DISCLOSURE. It
 * is the only field here that changes whether the page works for somebody, and
 * asking for it at the moment the picture is on screen is the only moment the
 * answer is easy. It is not required — a forced field gets "image" typed into
 * it — but leaving it empty is a deliberate, labelled choice.
 */
export function ImageField({
  value,
  owner,
  onChange,
  onRemove,
  label = "Image",
}: {
  value: ImageRef | null;
  owner: SiteOwner;
  onChange: (ref: ImageRef) => void;
  onRemove?: () => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown from the prepared canvas immediately, so the thumbnail appears while
  // Cloudinary is still being talked to rather than after.
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const ref = await uploadSiteImage(file);
      setPreview(null);
      onChange(ref);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const thumb = preview ?? (value ? mediaUrl(owner.id, value.id, value.v, 400) : null);

  return (
    <div className="space-y-2 rounded-brutal border-2 border-ink bg-canvas p-3">
      <div className="flex items-start gap-3">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-brutal border-2 border-ink bg-paper">
          {thumb ? (
            // A data: URL preview cannot go through next/image, and this
            // element swaps between that and a Cloudinary URL already sized by
            // its transformation chain.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : (
            <div aria-hidden className="flex size-full items-center justify-center text-2xl">
              🖼
            </div>
          )}
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-[10px] font-semibold text-paper">
              Uploading…
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="min-h-11 rounded-full border-2 border-ink bg-lime px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm disabled:opacity-50"
            >
              {value ? "Replace" : `Choose ${label.toLowerCase()}`}
            </button>
            {value && onRemove ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRemove}
                className="min-h-11 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm disabled:opacity-40"
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="text-xs font-medium text-ink/70">
            {/* Both facts are ones people ask about after the fact, when it is
                too late to matter. */}
            JPEG, PNG, WebP or AVIF. Location data is removed before upload.
          </p>
        </div>
      </div>

      {value ? (
        <label className="block">
          <span className="block text-xs font-semibold">Describe it (optional)</span>
          <input
            value={value.alt}
            onChange={(event) => onChange({ ...value, alt: event.target.value })}
            placeholder="Leave empty if it's decorative"
            className="mt-1 w-full rounded-brutal border-2 border-ink bg-paper px-3 py-2 text-base font-medium shadow-brutal-sm sm:text-sm"
          />
          <span className="mt-1 block text-xs font-medium text-ink/70">
            Read aloud to anyone using a screen reader, and shown if the image
            can&apos;t load.
          </span>
        </label>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-full border-2 border-ink bg-coral px-2.5 py-1.5 text-xs font-semibold"
        >
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";

import { parseConnectToken } from "@/lib/qr/connect-url";

type Status =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "found" }
  | { kind: "error"; message: string };

export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  // Guards against the decode loop firing navigation twice on consecutive
  // frames — a QR code stays in view for many frames after the first read.
  const handledRef = useRef(false);

  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [lastRejected, setLastRejected] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({
          kind: "error",
          message: "This browser can't use the camera. Try opening the link on your phone.",
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iOS Safari refuses to play inline without both of these.
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play();

        setStatus({ kind: "scanning" });
        tick();
      } catch (cause) {
        if (cancelled) return;
        const name = cause instanceof DOMException ? cause.name : "";
        setStatus({
          kind: "error",
          message:
            name === "NotAllowedError"
              ? "Camera access was blocked. Allow it in your browser settings, then reload."
              : name === "NotFoundError"
                ? "No camera found on this device."
                : "Couldn't start the camera.",
        });
      }
    }

    function tick() {
      frameRef.current = requestAnimationFrame(tick);
      if (handledRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: "dontInvert",
      });
      if (!decoded) return;

      // Never navigate to the scanned URL. parseConnectToken returns a bare
      // token, and we build our own path from it — a QR code is attacker-
      // supplied input and this is the only thing standing between it and an
      // arbitrary redirect.
      const token = parseConnectToken(decoded.data);
      if (!token) {
        setLastRejected(decoded.data.slice(0, 80));
        return; // keep scanning; they may be pointing at some other QR code
      }

      handledRef.current = true;
      setStatus({ kind: "found" });
      stop();
      router.push(`/connect/${token}`);
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [router, stop]);

  return (
    <div className="mt-6">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-current/15 bg-black">
        <video ref={videoRef} className="size-full object-cover" playsInline muted />
        {status.kind === "scanning" ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/70"
          />
        ) : null}
        {status.kind !== "scanning" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            {status.kind === "starting" && "Starting the camera…"}
            {status.kind === "found" && "Got it — connecting…"}
            {status.kind === "error" && status.message}
          </div>
        ) : null}
      </div>

      <p role="status" className="mt-3 text-sm opacity-70">
        {status.kind === "scanning"
          ? "Point the camera at someone's QR Connect code."
          : " "}
      </p>

      {lastRejected && status.kind === "scanning" ? (
        <p className="mt-1 text-xs opacity-50">
          That looks like a QR code, but not a QR Connect one.
        </p>
      ) : null}
    </div>
  );
}

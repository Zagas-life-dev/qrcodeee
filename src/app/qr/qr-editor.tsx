"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import jsQR from "jsqr";
import type QRCodeStyling from "qr-code-styling";

import { mintQrToken, rotateToken, saveQrStyle } from "@/lib/qr/actions";
import {
  CORNER_STYLES,
  DOT_STYLES,
  SAFE_DEFAULT_STYLE,
  errorCorrectionFor,
  hasUsableContrast,
  type QrStyle,
} from "@/lib/qr/style";

type Props = { initialStyle: QrStyle; connectUrl: string; expiresAt: string };

/**
 * Refresh this long before the token actually dies (§6).
 *
 * The server hands out a token only while it has more than a minute left, so
 * refreshing at ninety seconds guarantees the displayed code always resolves —
 * a scanner that lines up the shot just as the code rolls over still succeeds.
 * Cutting this closer trades a real scan failure for nothing.
 */
const REFRESH_MARGIN_MS = 90_000;

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "pass" }
  | { kind: "fail"; reason: string };

export function QrEditor({ initialStyle, connectUrl, expiresAt }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  // Type-only import: qr-code-styling touches the DOM at construction, so the
  // runtime import has to stay lazy (inside the effect below) — but the type
  // costs nothing at runtime and beats an `any` here.
  const instance = useRef<QRCodeStyling | null>(null);

  const [style, setStyle] = useState(initialStyle);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState(connectUrl);
  const [expiry, setExpiry] = useState(expiresAt);

  const options = useCallback(
    (s: QrStyle) => ({
      width: 288,
      height: 288,
      type: "canvas" as const,
      data: url,
      margin: 8,
      // §6: high error correction whenever a logo is embedded, because the logo
      // covers modules the decoder then has to reconstruct.
      qrOptions: { errorCorrectionLevel: errorCorrectionFor(s) },
      image: s.logoUrl ?? undefined,
      imageOptions: { crossOrigin: "anonymous", margin: 4, imageSize: 0.3 },
      dotsOptions: { color: s.dotColor, type: s.dotStyle },
      cornersSquareOptions: { color: s.dotColor, type: s.cornerStyle },
      backgroundOptions: { color: s.backgroundColor },
    }),
    [url],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { default: QRCodeStyling } = await import("qr-code-styling");
      if (cancelled) return;
      if (!instance.current) {
        instance.current = new QRCodeStyling(options(style));
        if (holder.current) {
          holder.current.replaceChildren();
          instance.current.append(holder.current);
        }
      } else {
        instance.current.update(options(style));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [style, options]);

  /**
   * Keeps the displayed code from going stale (§6).
   *
   * The visibilitychange half is not belt-and-braces. Browsers throttle timers
   * in background tabs and stop them entirely on a locked phone, which is the
   * ordinary way this screen is used: open your code, lock the screen, hand the
   * phone over ten minutes later. The timer alone would leave a dead QR on
   * display with no indication anything was wrong — the scanner would just get
   * "this code is no longer active".
   */
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await mintQrToken();
      if (cancelled || !result.ok) return;
      setUrl(`${window.location.origin}/connect/${result.token}`);
      setExpiry(result.expiresAt);
      // The previous pass validated a URL that no longer exists.
      setTest({ kind: "idle" });
    }

    const dueIn = new Date(expiry).getTime() - Date.now() - REFRESH_MARGIN_MS;
    const timer = setTimeout(() => void refresh(), Math.max(0, dueIn));

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (new Date(expiry).getTime() - Date.now() <= REFRESH_MARGIN_MS) void refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [expiry]);

  /**
   * The §6 guardrail: render the code, decode it back, and only accept the style
   * if the decoded payload is byte-identical to the URL we meant to encode.
   *
   * Checking equality rather than "did it decode" matters — a heavily styled
   * code can decode to a corrupted string, which is a failure that looks like a
   * success if you only test for truthiness.
   *
   * §6 is also explicit that this is a baseline, not a guarantee: a code that
   * decodes on a laptop can still fail printed, in low light, at distance, or
   * behind screen glare. Hence the note in the UI.
   */
  const runScanTest = useCallback(async (): Promise<boolean> => {
    setTest({ kind: "testing" });
    try {
      const qr = instance.current;
      if (!qr) throw new Error("The preview hasn't finished rendering.");

      // getRawData is typed Blob | Buffer | null — Buffer on the Node path, null
      // if rendering hasn't produced anything. Neither is usable here, and a
      // silent failure would read as a passing test.
      const raw = await qr.getRawData("png");
      if (!(raw instanceof Blob)) {
        setTest({ kind: "fail", reason: "Couldn't render the code to test it." });
        return false;
      }

      const bitmap = await createImageBitmap(raw);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Couldn't read the preview.");
      ctx.drawImage(bitmap, 0, 0);

      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(pixels.data, pixels.width, pixels.height);

      if (!decoded) {
        setTest({ kind: "fail", reason: "This style can't be read by a scanner." });
        return false;
      }
      if (decoded.data !== url) {
        setTest({ kind: "fail", reason: "This style decodes to the wrong address." });
        return false;
      }
      setTest({ kind: "pass" });
      return true;
    } catch (cause) {
      setTest({
        kind: "fail",
        reason: cause instanceof Error ? cause.message : "The scan test failed.",
      });
      return false;
    }
  }, [url]);

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      // Gate the save on a real decode, not on the contrast heuristic.
      const passed = await runScanTest();
      if (!passed) return;

      const result = await saveQrStyle(style);
      setMessage(result.ok ? "QR style saved." : result.message);
    });
  }

  function handleRotate() {
    setMessage(null);
    startTransition(async () => {
      const result = await rotateToken();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setUrl(`${window.location.origin}/connect/${result.token}`);
      setExpiry(result.expiresAt);
      setTest({ kind: "idle" });
      setMessage(
        "New QR code generated, and every earlier one is now dead — including on your other devices. Your existing connections are unaffected.",
      );
    });
  }

  const contrastPoor = !hasUsableContrast(style);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div>
        <div
          ref={holder}
          className="rounded-lg border border-current/15 p-3"
          style={{ background: style.backgroundColor }}
        />
        <p className="mt-2 max-w-72 break-all font-mono text-[10px] opacity-40">{url}</p>
      </div>

      <div className="space-y-5">
        <Swatch
          label="Dot colour"
          value={style.dotColor}
          onChange={(dotColor) => { setStyle({ ...style, dotColor }); setTest({ kind: "idle" }); }}
        />
        <Swatch
          label="Background"
          value={style.backgroundColor}
          onChange={(backgroundColor) => { setStyle({ ...style, backgroundColor }); setTest({ kind: "idle" }); }}
        />
        <Choice
          label="Dot style"
          value={style.dotStyle}
          options={DOT_STYLES}
          onChange={(dotStyle) => { setStyle({ ...style, dotStyle }); setTest({ kind: "idle" }); }}
        />
        <Choice
          label="Corner style"
          value={style.cornerStyle}
          options={CORNER_STYLES}
          onChange={(cornerStyle) => { setStyle({ ...style, cornerStyle }); setTest({ kind: "idle" }); }}
        />

        {contrastPoor ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            These colours are very close together. Scanners will probably
            struggle — try a darker dot colour on a lighter background.
          </p>
        ) : null}

        {test.kind === "fail" ? (
          <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs">
            {test.reason} Your saved code is unchanged.
          </p>
        ) : null}
        {test.kind === "pass" ? (
          <p className="rounded-md border border-current/15 px-3 py-2 text-xs opacity-70">
            Decoded correctly. Worth checking it printed and in low light too —
            a code that reads on screen can still fail in the real world.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md border border-current/15 px-3 py-1.5 text-sm font-medium transition hover:bg-current/5 disabled:opacity-50"
          >
            {test.kind === "testing" ? "Testing…" : isPending ? "Saving…" : "Test & save"}
          </button>
          <button
            type="button"
            onClick={() => { setStyle(SAFE_DEFAULT_STYLE); setTest({ kind: "idle" }); }}
            disabled={isPending}
            className="rounded-md px-3 py-1.5 text-sm opacity-70 transition hover:bg-current/5 hover:opacity-100 disabled:opacity-40"
          >
            Reset to default
          </button>
          {message ? <p className="text-sm opacity-70">{message}</p> : null}
        </div>

        <div className="border-t border-current/10 pt-5">
          <button
            type="button"
            onClick={handleRotate}
            disabled={isPending}
            className="rounded-md border border-current/15 px-3 py-1.5 text-sm transition hover:bg-current/5 disabled:opacity-50"
          >
            Generate a new QR code
          </button>
          <p className="mt-2 max-w-md text-xs opacity-60">
            Anything already printed or shared stops working. People you&apos;re
            already connected to are unaffected — connections don&apos;t depend
            on the code.
          </p>
        </div>
      </div>
    </div>
  );
}

function Swatch({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-sm font-medium" htmlFor={label}>{label}</label>
      <input
        id={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-8 cursor-pointer rounded border border-current/15 bg-transparent"
      />
      <span className="font-mono text-xs opacity-50">{value}</span>
    </div>
  );
}

function Choice<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-sm font-medium" htmlFor={label}>{label}</label>
      <select
        id={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-current/15 bg-transparent px-2 py-1.5 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-neutral-900 text-white">
            {option.replace(/-/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

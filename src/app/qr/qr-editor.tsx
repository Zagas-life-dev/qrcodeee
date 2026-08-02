"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import jsQR from "jsqr";
import type QRCodeStyling from "qr-code-styling";

import { mintQrToken, rotateToken, saveQrStyle } from "@/lib/qr/actions";
import { Section, actionClass } from "@/components/page";
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
 * MUST STAY BELOW mint_qr_token's reuse floor, which is two minutes. The server
 * reuses a token that still has more than that left, so refreshing any later
 * than its floor returns the SAME token: setExpiry() below would be a no-op, the
 * effect would never re-run, no new timer would be scheduled, and the code would
 * sit here until it quietly expired. Nothing on this screen would look wrong —
 * scanners would just start getting "this code is no longer active".
 *
 * Ninety seconds also means a scanner lining up the shot just as the code rolls
 * over still succeeds. Cutting it closer trades a real scan failure for nothing.
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
    // The code leads and the controls follow, rather than the two sharing a
    // row. Styling your code is a thing you do once; showing it is the thing
    // you do in front of another person, and on a phone the previous two-column
    // grid stacked into "here are some colour pickers, scroll for your code".
    <div className="mt-8 space-y-8">
      <div className="flex flex-col items-center">
        {/* The frame is the app's; the fill inside it is the USER's chosen QR
            background, which is why this one surface doesn't take bg-paper. */}
        <div
          ref={holder}
          className="rounded-brutal-lg border-2 border-ink p-3 shadow-brutal-lg"
          style={{ background: style.backgroundColor }}
        />
        <p className="mt-4 max-w-72 text-center font-mono text-[10px] break-all text-ink/55">
          {url}
        </p>
      </div>

      <Section title="Style" className="mt-0">
      <div className="space-y-5 rounded-brutal border-2 border-ink bg-paper p-4 shadow-brutal">
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
          <p className="rounded-brutal border-2 border-ink bg-lemon px-3 py-2 text-xs font-semibold">
            These colours are very close together. Scanners will probably
            struggle — try a darker dot colour on a lighter background.
          </p>
        ) : null}

        {test.kind === "fail" ? (
          <p
            role="alert"
            className="rounded-brutal border-2 border-ink bg-coral px-3 py-2 text-xs font-semibold"
          >
            {test.reason} Your saved code is unchanged.
          </p>
        ) : null}
        {test.kind === "pass" ? (
          <p className="rounded-brutal border-2 border-ink bg-lime px-3 py-2 text-xs font-semibold">
            Decoded correctly. Worth checking it printed and in low light too —
            a code that reads on screen can still fail in the real world.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className={actionClass({ tone: "primary", size: "lg" })}
          >
            {test.kind === "testing" ? "Testing…" : isPending ? "Saving…" : "Test & save"}
          </button>
          <button
            type="button"
            onClick={() => { setStyle(SAFE_DEFAULT_STYLE); setTest({ kind: "idle" }); }}
            disabled={isPending}
            className={actionClass()}
          >
            Reset to default
          </button>
          {message ? <p className="text-sm font-medium">{message}</p> : null}
        </div>
      </div>
      </Section>

      {/* Its own section rather than a divider inside the style card: rotating
          the token has nothing to do with how the code looks, and sharing a
          surface with "Reset to default" invited reading them as a pair. */}
      <Section
        title="Start over"
        description="Anything already printed or shared stops working. People you're already connected to are unaffected — connections don't depend on the code."
        className="mt-0"
      >
        <button
          type="button"
          onClick={handleRotate}
          disabled={isPending}
          className={actionClass()}
        >
          Generate a new QR code
        </button>
      </Section>
    </div>
  );
}

function Swatch({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 font-display text-sm" htmlFor={label}>{label}</label>
      <input
        id={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-full border-2 border-ink bg-paper shadow-brutal-sm nb-press-sm"
      />
      <span className="font-mono text-xs font-semibold text-ink/70">{value}</span>
    </div>
  );
}

function Choice<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 font-display text-sm" htmlFor={label}>{label}</label>
      <select
        id={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-h-11 min-w-0 rounded-brutal border-2 border-ink bg-paper px-2 text-base font-semibold shadow-brutal-sm sm:text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-paper text-ink">
            {option.replace(/-/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import "./profile-card.css";

/**
 * prefers-reduced-motion as an external store, matching how this app already
 * reads Notification.permission (see enable-notifications.tsx). Reading it into
 * state inside an effect works but costs a second render pass on every mount,
 * and the media query is precisely the "external system" this hook exists for.
 *
 * The server snapshot is `false` — motion allowed. It has to guess, and guessing
 * wrong costs nothing visible: every motion in this card is driven by a pointer
 * event that hasn't happened yet at hydration time.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const getServerReducedMotion = () => false;

/**
 * ProfileCard — React Bits (JavaScript + CSS variant), ported to TypeScript.
 *
 * Kept structurally identical to upstream so it stays diffable. The behavioural
 * changes are marked LOCAL and there are three; the styling ones live in
 * profile-card.css.
 *
 * The props are upstream's, minus the ones this app has no data for. `handle`
 * and `status` are optional here rather than defaulted to demo strings, because
 * a profile in this product has neither — inventing "@javicodes / Online" for a
 * real person is worse than omitting the line.
 */

const ANIMATION_CONFIG = {
  INITIAL_DURATION: 1200,
  INITIAL_X_OFFSET: 70,
  INITIAL_Y_OFFSET: 60,
  DEVICE_BETA_OFFSET: 20,
  ENTER_TRANSITION_MS: 180,
} as const;

const clamp = (v: number, min = 0, max = 100) => Math.min(Math.max(v, min), max);
const round = (v: number, precision = 3) => parseFloat(v.toFixed(precision));

export type ProfileCardProps = {
  avatarUrl?: string | null;
  iconUrl?: string;
  grainUrl?: string;
  /**
   * The card's flat fill, as any CSS colour. Replaces upstream's
   * `innerGradient`, which described a soft two-stop wash this skin has no
   * gradients to put it in — see profile-card.css.
   */
  accent?: string;
  className?: string;
  enableTilt?: boolean;
  enableMobileTilt?: boolean;
  mobileTiltSensitivity?: number;
  miniAvatarUrl?: string | null;
  name?: string;
  title?: string;
  handle?: string;
  status?: string;
  contactText?: string;
  showUserInfo?: boolean;
  onContactClick?: () => void;
};

function ProfileCardComponent({
  avatarUrl,
  iconUrl,
  grainUrl,
  accent,
  className = "",
  enableTilt = true,
  enableMobileTilt = false,
  mobileTiltSensitivity = 5,
  miniAvatarUrl,
  name = "",
  title,
  handle,
  status,
  contactText = "Contact",
  showUserInfo = true,
  onContactClick,
}: ProfileCardProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const enterTimerRef = useRef<number | null>(null);
  const leaveRafRef = useRef<number | null>(null);

  /**
   * LOCAL 1: honour prefers-reduced-motion.
   *
   * Upstream tilts regardless. The tilt is continuous motion tracking the
   * cursor, which is squarely what this setting is for — and unlike the CSS
   * animations, no global stylesheet rule can switch off a transform that JS is
   * writing into a custom property every frame. Live-subscribed, so toggling
   * the OS setting takes effect without a reload.
   */
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  );

  const tiltActive = enableTilt && !reduced;

  const [avatarBroken, setAvatarBroken] = useState(false);
  const [miniBroken, setMiniBroken] = useState(false);

  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const showAvatar = Boolean(avatarUrl) && !avatarBroken;
  const miniSrc = miniAvatarUrl || avatarUrl;
  const showMini = Boolean(miniSrc) && !miniBroken;

  const tiltEngine = useMemo(() => {
    if (!tiltActive) return null;

    let rafId: number | null = null;
    let running = false;
    let lastTs = 0;

    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const DEFAULT_TAU = 0.14;
    const INITIAL_TAU = 0.6;
    let initialUntil = 0;

    const setVarsFromXY = (x: number, y: number) => {
      const shell = shellRef.current;
      const wrap = wrapRef.current;
      if (!shell || !wrap) return;

      const width = shell.clientWidth || 1;
      const height = shell.clientHeight || 1;

      const percentX = clamp((100 / width) * x);
      const percentY = clamp((100 / height) * y);

      const centerX = percentX - 50;
      const centerY = percentY - 50;

      // Upstream also writes --background-x/y and --pointer-from-center here.
      // Both fed the foil and the glare, which this app no longer renders, so
      // they were style writes on every pointer frame that nothing read.
      const properties: Record<string, string> = {
        "--pointer-x": `${percentX}%`,
        "--pointer-y": `${percentY}%`,
        "--pointer-from-top": `${percentY / 100}`,
        "--pointer-from-left": `${percentX / 100}`,
        "--rotate-x": `${round(-(centerX / 5))}deg`,
        "--rotate-y": `${round(centerY / 4)}deg`,
      };

      for (const [k, v] of Object.entries(properties)) wrap.style.setProperty(k, v);
    };

    const step = (ts: number) => {
      if (!running) return;
      if (lastTs === 0) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      const tau = ts < initialUntil ? INITIAL_TAU : DEFAULT_TAU;
      const k = 1 - Math.exp(-dt / tau);

      currentX += (targetX - currentX) * k;
      currentY += (targetY - currentY) * k;

      setVarsFromXY(currentX, currentY);

      const stillFar =
        Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05;

      /**
       * LOCAL 2: upstream's condition here is `stillFar || document.hasFocus()`,
       * which never becomes false while the window is focused — so the loop
       * keeps requesting frames forever, at rest, doing nothing but recomputing
       * the same nine custom properties sixty times a second. On an installed
       * PWA that is a permanent foreground battery drain.
       *
       * The settle check alone is the whole point of the easing: once the card
       * has reached its target there is nothing left to animate, and the next
       * pointer event calls start() again.
       */
      if (stillFar) {
        rafId = requestAnimationFrame(step);
      } else {
        running = false;
        lastTs = 0;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    };

    return {
      setImmediate(x: number, y: number) {
        currentX = x;
        currentY = y;
        setVarsFromXY(currentX, currentY);
      },
      setTarget(x: number, y: number) {
        targetX = x;
        targetY = y;
        start();
      },
      toCenter() {
        const shell = shellRef.current;
        if (!shell) return;
        this.setTarget(shell.clientWidth / 2, shell.clientHeight / 2);
      },
      beginInitial(durationMs: number) {
        initialUntil = performance.now() + durationMs;
        start();
      },
      getCurrent() {
        return { x: currentX, y: currentY, tx: targetX, ty: targetY };
      },
      cancel() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        running = false;
        lastTs = 0;
      },
    };
  }, [tiltActive]);

  const getOffsets = (evt: PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell || !tiltEngine) return;
      const { x, y } = getOffsets(event, shell);
      tiltEngine.setTarget(x, y);
    },
    [tiltEngine],
  );

  const handlePointerEnter = useCallback(
    (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell || !tiltEngine) return;

      shell.classList.add("active");
      shell.classList.add("entering");
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = window.setTimeout(() => {
        shell.classList.remove("entering");
      }, ANIMATION_CONFIG.ENTER_TRANSITION_MS);

      const { x, y } = getOffsets(event, shell);
      tiltEngine.setTarget(x, y);
    },
    [tiltEngine],
  );

  const handlePointerLeave = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || !tiltEngine) return;

    tiltEngine.toCenter();

    const checkSettle = () => {
      const { x, y, tx, ty } = tiltEngine.getCurrent();
      const settled = Math.hypot(tx - x, ty - y) < 0.6;
      if (settled) {
        shell.classList.remove("active");
        leaveRafRef.current = null;
      } else {
        leaveRafRef.current = requestAnimationFrame(checkSettle);
      }
    };
    if (leaveRafRef.current) cancelAnimationFrame(leaveRafRef.current);
    leaveRafRef.current = requestAnimationFrame(checkSettle);
  }, [tiltEngine]);

  const handleDeviceOrientation = useCallback(
    (event: DeviceOrientationEvent) => {
      const shell = shellRef.current;
      if (!shell || !tiltEngine) return;

      const { beta, gamma } = event;
      if (beta == null || gamma == null) return;

      const centerX = shell.clientWidth / 2;
      const centerY = shell.clientHeight / 2;
      const x = clamp(centerX + gamma * mobileTiltSensitivity, 0, shell.clientWidth);
      const y = clamp(
        centerY + (beta - ANIMATION_CONFIG.DEVICE_BETA_OFFSET) * mobileTiltSensitivity,
        0,
        shell.clientHeight,
      );

      tiltEngine.setTarget(x, y);
    },
    [tiltEngine, mobileTiltSensitivity],
  );

  useEffect(() => {
    if (!tiltActive || !tiltEngine) return;

    const shell = shellRef.current;
    if (!shell) return;

    shell.addEventListener("pointerenter", handlePointerEnter);
    shell.addEventListener("pointermove", handlePointerMove);
    shell.addEventListener("pointerleave", handlePointerLeave);

    const handleClick = () => {
      if (!enableMobileTilt || location.protocol !== "https:") return;
      const anyMotion = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<PermissionState>;
      };
      if (anyMotion && typeof anyMotion.requestPermission === "function") {
        anyMotion
          .requestPermission()
          .then((state) => {
            if (state === "granted") {
              window.addEventListener("deviceorientation", handleDeviceOrientation);
            }
          })
          .catch(console.error);
      } else {
        window.addEventListener("deviceorientation", handleDeviceOrientation);
      }
    };
    shell.addEventListener("click", handleClick);

    const initialX = (shell.clientWidth || 0) - ANIMATION_CONFIG.INITIAL_X_OFFSET;
    const initialY = ANIMATION_CONFIG.INITIAL_Y_OFFSET;
    tiltEngine.setImmediate(initialX, initialY);
    tiltEngine.toCenter();
    tiltEngine.beginInitial(ANIMATION_CONFIG.INITIAL_DURATION);

    return () => {
      shell.removeEventListener("pointerenter", handlePointerEnter);
      shell.removeEventListener("pointermove", handlePointerMove);
      shell.removeEventListener("pointerleave", handlePointerLeave);
      shell.removeEventListener("click", handleClick);
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
      if (leaveRafRef.current) cancelAnimationFrame(leaveRafRef.current);
      tiltEngine.cancel();
      shell.classList.remove("entering");
    };
  }, [
    tiltActive,
    enableMobileTilt,
    tiltEngine,
    handlePointerMove,
    handlePointerEnter,
    handlePointerLeave,
    handleDeviceOrientation,
  ]);

  const cardStyle = useMemo(
    () =>
      ({
        "--icon": iconUrl ? `url(${iconUrl})` : "none",
        "--grain": grainUrl ? `url(${grainUrl})` : "none",
        // Left unset when no accent is given, so the stylesheet's own default
        // (the app's lilac) applies rather than being overwritten with it here.
        ...(accent ? { "--pc-fill": accent } : {}),
      }) as React.CSSProperties,
    [iconUrl, grainUrl, accent],
  );

  const handleContactClick = useCallback(() => {
    onContactClick?.();
  }, [onContactClick]);

  return (
    <div ref={wrapRef} className={`pc-card-wrapper ${className}`.trim()} style={cardStyle}>
      <div ref={shellRef} className="pc-card-shell">
        <section className="pc-card">
          <div className="pc-inside">
            {/* Upstream's holographic foil and glare sweep are gone. They tinted
                the card — and everything seen through the info panel — with
                four multiplied colour bands that tracked the pointer, which
                read as discolouration rather than as sheen. The fill is flat
                now; the tilt and parallax still carry the depth. */}
            <div className="pc-content pc-avatar-content">
              {/* LOCAL 3: upstream hides a broken <img> and leaves a hole. */}
              {showAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="avatar"
                  src={avatarUrl ?? undefined}
                  alt=""
                  loading="lazy"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="pc-avatar-fallback" aria-hidden>
                  {initial}
                </div>
              )}
              {showUserInfo && (
                <div className="pc-user-info">
                  <div className="pc-user-details">
                    <div className="pc-mini-avatar">
                      {showMini ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={miniSrc ?? undefined}
                          alt=""
                          loading="lazy"
                          onError={() => setMiniBroken(true)}
                        />
                      ) : (
                        <div className="pc-mini-fallback" aria-hidden>
                          {initial}
                        </div>
                      )}
                    </div>
                    <div className="pc-user-text">
                      {handle ? <div className="pc-handle">@{handle}</div> : null}
                      {status ? <div className="pc-status">{status}</div> : null}
                    </div>
                  </div>
                  {onContactClick ? (
                    <button
                      className="pc-contact-btn"
                      onClick={handleContactClick}
                      style={{ pointerEvents: "auto" }}
                      type="button"
                      aria-label={`${contactText}${name ? ` — ${name}` : ""}`}
                    >
                      {contactText}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            <div className="pc-content">
              <div className="pc-details">
                <h3>{name}</h3>
                {title ? <p>{title}</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const ProfileCard = React.memo(ProfileCardComponent);
export default ProfileCard;

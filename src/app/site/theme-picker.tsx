"use client";

import {
  SITE_DENSITIES,
  SITE_FONTS,
  SITE_RADII,
  SITE_SKINS,
  type SiteFont,
  type SiteSkin,
  type SiteTheme,
} from "@/lib/site/theme";
import { useSiteStore } from "@/lib/site/store";

/**
 * Skin and font picker (site-spec S7).
 *
 * EACH SWATCH IS THE REAL THING, NOT A PICTURE OF IT. The preview tile carries
 * `.site-theme[data-skin=…]` and the same `.sk-surface`/`.sk-chip` classes the
 * public page uses, so it is styled by exactly the CSS that will style the page.
 * A hand-drawn approximation is a second definition of six looks that then has
 * to be kept in step with the first, and the failure mode is a picker that lies.
 *
 * `theme` comes from the DRAFT, not from the server row, so this component
 * holds no state of its own. It used to keep a local copy and roll it back when
 * the action failed — a private, second answer to "what does this page look
 * like" that only this component could see. The queue in store.tsx does the same
 * job for every control at once, and the picker highlights whatever the page is
 * actually going to be.
 *
 * NO SECTION HEADING OF ITS OWN ANY MORE. This used to be a `<Section>` dropped
 * into the middle of the editor's single scrolling column, between the sections
 * you were arranging and the button that added another one — page-wide styling
 * interleaved with per-section structure. It is now the Design tab of the
 * inspector (editor-panel.tsx), which supplies the heading and the framing, so
 * the component is the controls and nothing else.
 */
export function ThemeControls({ theme }: { theme: SiteTheme }) {
  const { mutate } = useSiteStore();
  const current = theme;

  const apply = (next: SiteTheme) => mutate({ kind: "setTheme", theme: next });

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Style</legend>

        {/* Two columns even in the rail: the tiles are square-ish previews, and
            one per row would put the six skins over a screen and a half. */}
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-2">
          {(Object.keys(SITE_SKINS) as SiteSkin[]).map((skin) => {
            const active = current.skin === skin;
            return (
              <li key={skin}>
                <button
                  type="button"
                  onClick={() => apply({ ...current, skin })}
                  aria-pressed={active}
                  className={`w-full rounded-brutal border-2 border-ink text-left shadow-brutal-sm nb-press-sm ${
                    active ? "bg-lilac" : "bg-paper"
                  }`}
                >
                  {/* The preview. `pointer-events-none` because the whole tile
                      is the button — a chip inside it must not swallow taps. */}
                  <span
                    className="site-theme site-theme-swatch pointer-events-none flex h-16 items-center justify-center gap-1.5 overflow-hidden rounded-t-[20px] border-b-2 border-ink p-2"
                    data-skin={skin}
                    data-font={current.font}
                    aria-hidden
                  >
                    <span className="sk-surface h-9 w-10 shrink-0" />
                    <span className="sk-chip px-2 py-1 text-[10px] font-semibold">Aa</span>
                  </span>
                  <span className="block px-2.5 py-2">
                    <span className="block text-xs font-semibold">
                      {SITE_SKINS[skin].label}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-ink/70">
                      {SITE_SKINS[skin].hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Choice
            label="Corners"
            options={SITE_RADII}
            value={current.radius}
            onPick={(radius) => apply({ ...current, radius })}
          />
          <Choice
            label="Spacing"
            options={SITE_DENSITIES}
            value={current.density}
            onPick={(density) => apply({ ...current, density })}
          />
        </div>

        <h3 className="mt-5 font-display text-sm">Accent colour</h3>
        <p className="mt-1 text-xs font-medium text-ink/70">
          Used for highlighted blocks. We pick the text colour on top of it, so
          whatever you choose stays readable.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-paper px-3 shadow-brutal-sm">
            {/* A native colour input: it is the OS picker, it is keyboard
                accessible for free, and it can only ever produce `#rrggbb` —
                which is exactly the shape parseAccent accepts. */}
            <input
              type="color"
              value={current.accent ?? "#bca6f7"}
              onChange={(event) => apply({ ...current, accent: event.target.value })}
              aria-label="Accent colour"
              className="size-7 cursor-pointer rounded-full border-2 border-ink bg-transparent p-0"
            />
            <span className="font-mono text-xs">{current.accent ?? "default"}</span>
          </label>

          {current.accent ? (
            <button
              type="button"
              onClick={() => apply({ ...current, accent: null })}
              className="min-h-11 rounded-full border-2 border-ink bg-paper px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm"
            >
              Use the skin&apos;s
            </button>
          ) : null}
        </div>

        <h3 className="mt-5 font-display text-sm">Typeface</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(SITE_FONTS) as SiteFont[]).map((font) => {
            const active = current.font === font;
            return (
              <li key={font}>
                <button
                  type="button"
                  onClick={() => apply({ ...current, font })}
                  aria-pressed={active}
                  title={SITE_FONTS[font].hint}
                  // The label is set in the face it names, so the choice is
                  // legible from the control rather than from its description.
                  className={`site-theme min-h-11 rounded-full border-2 border-ink px-4 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
                    active ? "bg-lilac" : "bg-paper"
                  }`}
                  data-font={font}
                >
                  {SITE_FONTS[font].label}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}

/**
 * A labelled row of mutually exclusive pills.
 *
 * Generic over the option map so `SITE_RADII` and `SITE_DENSITIES` share it —
 * they are the same control with different keys, and two copies is two places
 * for the active-state styling to drift.
 */
function Choice<K extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Record<K, { label: string }>;
  value: K;
  onPick: (next: K) => void;
}) {
  return (
    <div>
      <h3 className="font-display text-sm">{label}</h3>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={label}>
        {(Object.keys(options) as K[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onPick(key)}
            className={`min-h-11 rounded-full border-2 border-ink px-3.5 text-sm font-semibold shadow-brutal-sm nb-press-sm ${
              value === key ? "bg-lilac" : "bg-paper"
            }`}
          >
            {options[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}

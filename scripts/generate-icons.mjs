/**
 * Rasterises the PWA icon set from the mark in `src/lib/brand-art.ts`.
 *
 *   node --experimental-strip-types scripts/generate-icons.mjs
 *
 * The type-stripping flag is what lets a plain Node script import the same .ts
 * geometry module the React component uses (Node 22.6+). That shared import is
 * the entire point of this script existing: hand-exported icon binaries drift
 * from the on-screen logo, and nothing catches it because a PNG has no compiler.
 *
 * Re-run it whenever the mark changes. Output is committed — there is no build
 * step wired to this, deliberately, because rasterising on every build would
 * make the icons a moving target for caching.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { BRAND, markSvg } from "../src/lib/brand-art.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
/**
 * `favicon.ico` and `apple-icon.png` go here, NOT in public/.
 *
 * They are Next file conventions: the app directory versions are what generate
 * the <link rel="icon"> and <link rel="apple-touch-icon"> tags. Writing
 * favicon.ico to public/ as well is not merely redundant — both resolve to the
 * same /favicon.ico path and the build fails on the conflict.
 */
const APP = join(ROOT, "src", "app");

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();

/**
 * ICO, by hand — sharp has no .ico encoder.
 *
 * The format is a 6-byte header, one 16-byte directory entry per image, then the
 * payloads. Since Vista an entry's payload may be a whole PNG rather than a BMP,
 * which is what makes this tractable: the entries just point at PNGs sharp
 * already produced. A 0 in the width/height byte means 256.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const write = (name, buf, dir = PUBLIC) => {
  writeFileSync(join(dir, name), buf);
  console.log(`  ${dir === APP ? "src/app" : "public"}/${name}  ${(buf.length / 1024).toFixed(1)} kB`);
};

console.log("Skan QR icons →");

// The home-screen icon: mark on its lilac squircle.
const tile = markSvg({ tile: true });
write("icon-192.png", await render(tile, 192));
write("icon-512.png", await render(tile, 512));

/**
 * Maskable: Android crops this to whatever shape the launcher uses, so the mark
 * has to survive a circle inscribed in the square. The spec's safe zone is the
 * centre 80%, hence 10% padding — and the plate is extended to full bleed behind
 * it so the crop never exposes a transparent corner.
 */
write(
  "icon-maskable-512.png",
  await render(markSvg({ tile: true, padding: 8, background: BRAND.lilac }), 512),
);

/**
 * The notification badge. Android draws it as an alpha mask — every opaque pixel
 * becomes the status-bar tint, whatever colour it was — so this is rendered as a
 * white silhouette on transparent. Rendering the normal mark here gives a
 * solid blob, because the paper-coloured counter is opaque too and the mask
 * cannot tell it apart from the contour.
 */
write(
  "badge-96.png",
  await render(markSvg({ ink: "#ffffff", paper: "transparent" }), 96),
);

// Browser tab. Two sizes in one container: 32 for standard DPI, 48 for the
// bookmark/shortcut surfaces that ask for more.
const favicon = markSvg({ tile: true });
write(
  "favicon.ico",
  ico([
    { size: 32, data: await render(favicon, 32) },
    { size: 48, data: await render(favicon, 48) },
  ]),
  APP,
);

// Apple touch icon. iOS composites onto white and applies its own corner
// rounding, so this one gets an opaque background rather than the squircle's
// transparent surround.
write(
  "apple-icon.png",
  await render(markSvg({ tile: true, padding: 4, background: BRAND.paper }), 180),
  APP,
);

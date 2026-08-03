import { describe, expect, it } from "vitest";

import { SOCIAL_NETWORKS } from "./blocks";
import { SOCIAL_ICONS } from "./social-icons";

/**
 * The icon set is a `Record<SocialNetwork, IconSpec>`, so a missing network is
 * already a compile error. These tests cover what the type cannot: that the
 * paths are real path data rather than placeholders, and that every mark is
 * legible on the surface it is actually drawn on.
 */
describe("SOCIAL_ICONS", () => {
  const networks = Object.keys(SOCIAL_NETWORKS) as (keyof typeof SOCIAL_NETWORKS)[];

  it("covers exactly the networks that exist, with no extras", () => {
    // The reverse direction is the one the type system misses: an icon left
    // behind after a network is removed compiles fine and ships dead bytes.
    expect(Object.keys(SOCIAL_ICONS).sort()).toEqual([...networks].sort());
  });

  it.each(networks)("%s has usable path data", (network) => {
    const { path } = SOCIAL_ICONS[network];
    // Starts with a moveto, contains only path-data characters. A truncated
    // copy-paste — the realistic failure when hand-carrying twelve long
    // strings — renders as an unpredictable blob rather than throwing.
    expect(path).toMatch(/^M/);
    expect(path).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE ,.\-]+$/);
    expect(path.length).toBeGreaterThan(100);
  });

  it.each(networks)("%s brand colour reaches 3:1 against paper", (network) => {
    // --color-paper. The marks sit on it in both the public chip and the
    // editor's picker grid, and a mark below 3:1 is a smudge — WhatsApp's
    // primary green (#25D366) fails here at 1.95:1, which is why the entry
    // carries their darker green instead.
    expect(contrast(SOCIAL_ICONS[network].brand, "#fffdf7")).toBeGreaterThanOrEqual(3);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

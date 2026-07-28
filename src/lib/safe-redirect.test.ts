import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-redirect";

const FALLBACK = "/profile";

describe("safeNextPath", () => {
  describe("passes through legitimate same-origin destinations", () => {
    it.each([
      ["/profile", "/profile"],
      ["/connect/9f8c1b2a-0000-4444-8888-aaaabbbbcccc", "/connect/9f8c1b2a-0000-4444-8888-aaaabbbbcccc"],
      ["/connections?sort=recent", "/connections?sort=recent"],
      ["/profile#contact", "/profile#contact"],
    ])("%s -> %s", (input, expected) => {
      expect(safeNextPath(input)).toBe(expected);
    });
  });

  describe("falls back on missing input", () => {
    it.each([null, undefined, ""])("%s", (input) => {
      expect(safeNextPath(input)).toBe(FALLBACK);
    });
  });

  /**
   * The whole point of this helper. §5.1 requires the scan token to survive
   * login, so anyone can print a QR code pointing at /login?next=<anything> —
   * an attacker controls this value by design, and the OAuth callback is where
   * a user is least likely to notice being bounced off-site.
   */
  describe("refuses to leave the origin", () => {
    it.each([
      ["protocol-relative", "//evil.example"],
      ["protocol-relative with path", "//evil.example/steal"],
      ["absolute https", "https://evil.example/steal"],
      ["absolute http", "http://evil.example/steal"],
      ["backslash variant", "/\\evil.example"],
      ["double backslash", "\\\\evil.example"],
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/html,<script>alert(1)</script>"],
      ["scheme-relative with credentials", "//user:pass@evil.example"],
      ["whitespace-padded absolute", "  https://evil.example"],
    ])("%s: %s", (_label, input) => {
      expect(safeNextPath(input)).toBe(FALLBACK);
    });
  });

  it("never returns something that isn't a path", () => {
    const inputs = [
      "//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/legit",
      "relative",
      "?only=query",
    ];
    for (const input of inputs) {
      expect(safeNextPath(input).startsWith("/")).toBe(true);
    }
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("https://evil.example", "/login")).toBe("/login");
  });
});

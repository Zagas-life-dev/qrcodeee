import { describe, expect, it } from "vitest";

import { parseConnectToken } from "./connect-url";

const TOKEN = "9f8c1b2a-1111-4444-8888-aaaabbbbcccc";

describe("parseConnectToken", () => {
  it("reads the token from the current payload, /u/{handle}?c=", () => {
    expect(parseConnectToken(`https://qr.example/u/ada?c=${TOKEN}`)).toBe(TOKEN);
  });

  /**
   * Codes minted before the payload changed are printed on things we don't
   * control. They stay valid for as long as their token does, so the parser
   * keeps reading them — a deploy must not silently break every code in a
   * wallet.
   */
  it("still reads the pre-change payload, /connect/{token}", () => {
    expect(parseConnectToken(`https://qr.example/connect/${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores the handle in the URL — the token decides who you connect to", () => {
    // A hand-crafted code naming someone else must not change the outcome.
    // The handle is there so a plain camera app shows something recognisable.
    expect(parseConnectToken(`https://qr.example/u/someone-else?c=${TOKEN}`)).toBe(TOKEN);
  });

  it("accepts other origins — printed codes get scanned by localhost and previews", () => {
    expect(parseConnectToken(`http://localhost:3000/connect/${TOKEN}`)).toBe(TOKEN);
    expect(parseConnectToken(`https://preview-abc.vercel.app/u/ada?c=${TOKEN}`)).toBe(TOKEN);
  });

  it("accepts a bare token", () => {
    expect(parseConnectToken(TOKEN)).toBe(TOKEN);
    expect(parseConnectToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("normalises case, since the DB stores lowercase uuids", () => {
    expect(parseConnectToken(TOKEN.toUpperCase())).toBe(TOKEN);
  });

  it("ignores query strings and fragments", () => {
    expect(parseConnectToken(`https://qr.example/connect/${TOKEN}?utm=x#y`)).toBe(TOKEN);
  });

  describe("rejects anything that isn't a connect token", () => {
    it.each([
      ["empty", ""],
      ["whitespace", "   "],
      ["plain text", "hello world"],
      ["a different path", `https://qr.example/profile/${TOKEN}`],
      ["nested path", `https://qr.example/a/connect/${TOKEN}`],
      ["trailing segment", `https://qr.example/connect/${TOKEN}/extra`],
      ["missing token", "https://qr.example/connect/"],
      ["non-uuid token", "https://qr.example/connect/not-a-uuid"],
      // A public page with no code on it is a link, not a scan. Reading it as
      // one would turn every shared profile URL into a connection.
      ["a bare public page", "https://qr.example/u/ada"],
      ["public page, empty code", "https://qr.example/u/ada?c="],
      ["public page, non-uuid code", "https://qr.example/u/ada?c=not-a-uuid"],
      ["public page, no handle", `https://qr.example/u?c=${TOKEN}`],
      ["sql-ish payload", "https://qr.example/connect/' or 1=1--"],
      ["javascript scheme", `javascript:alert(1)`],
      ["data scheme", "data:text/html,<script>alert(1)</script>"],
      ["file scheme", `file:///connect/${TOKEN}`],
      ["a url with no path", "https://qr.example"],
    ])("%s", (_label, input) => {
      expect(parseConnectToken(input)).toBeNull();
    });
  });

  it("never returns a value that isn't a bare uuid", () => {
    const inputs = [
      `https://evil.example/connect/${TOKEN}`,
      TOKEN,
      `https://qr.example/connect/${TOKEN}?x=1`,
      `https://qr.example/u/ada?c=${TOKEN}&x=1`,
    ];
    for (const input of inputs) {
      const result = parseConnectToken(input);
      expect(result).not.toBeNull();
      expect(result).toMatch(/^[0-9a-f-]{36}$/);
      expect(result).not.toContain("/");
    }
  });
});

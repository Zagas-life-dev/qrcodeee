import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connectUrl, siteUrl } from "./site";

import { parseConnectToken } from "./qr/connect-url";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qr.example";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

describe("siteUrl", () => {
  it("strips trailing slashes so callers can concatenate blindly", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://qr.example///";
    expect(siteUrl()).toBe("https://qr.example");
  });

  it("throws rather than building a QR code pointing at nowhere", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => siteUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

const TOKEN = "9f8c1b2a-1111-4444-8888-aaaabbbbcccc";

describe("connectUrl", () => {
  it("encodes the public page, with the token riding along", () => {
    expect(connectUrl(TOKEN, "ada")).toBe(`https://qr.example/u/ada?c=${TOKEN}`);
  });

  /**
   * The round trip that matters: whatever we put in a QR code, the in-app
   * scanner has to be able to read a token back out of it. These two have
   * changed together once already and would silently stop agreeing again.
   */
  it("produces something the scanner can read the token back out of", () => {
    expect(parseConnectToken(connectUrl(TOKEN, "ada"))).toBe(TOKEN);
  });

  it("escapes a handle rather than letting it edit the URL", () => {
    // Handles are validated on the way in (lib/handles/format.ts), so this is
    // belt to that braces — but the value reaches a QR code that other people
    // scan, and a path separator smuggled through here would send them
    // somewhere else entirely.
    const url = connectUrl(TOKEN, "a/../evil");
    expect(url).toBe(`https://qr.example/u/a%2F..%2Fevil?c=${TOKEN}`);
    expect(new URL(url).pathname).toBe("/u/a%2F..%2Fevil");
  });
});

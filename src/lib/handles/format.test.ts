import { describe, expect, it } from "vitest";

import { handleProblem, isValidHandle, normalizeHandle } from "./format";

/**
 * These rules are a COPY of `profiles_handle_format` in
 * 20260802120000_handles.sql. The database is the enforcement; this suite is
 * what stops the copy drifting from it silently — a UI that accepts a handle the
 * DB rejects turns a form into an unexplained 500, and one that rejects a handle
 * the DB would accept is a name quietly taken off the table.
 *
 *   handle ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$' and handle !~ '^[0-9]+$'
 */
describe("normalizeHandle", () => {
  it("lowercases, since handles are stored lowercase", () => {
    expect(normalizeHandle("Ada")).toBe("ada");
    expect(normalizeHandle("ADA_LOVELACE")).toBe("ada_lovelace");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHandle("  ada  ")).toBe("ada");
  });

  it("does not decode — route params arrive already decoded", () => {
    // Decoding a second time would mangle a literal percent, or throw on a lone
    // one, turning a 404 into a 500.
    expect(normalizeHandle("100%")).toBe("100%");
    expect(normalizeHandle("a%20b")).toBe("a%20b");
  });

  it("is idempotent", () => {
    const once = normalizeHandle(" Ada_Lovelace ");
    expect(normalizeHandle(once)).toBe(once);
  });
});

describe("isValidHandle", () => {
  describe("accepts", () => {
    it.each([
      ["the shortest allowed", "abc"],
      ["digits inside", "ada99"],
      ["underscores inside", "ada_lovelace"],
      ["several underscores", "a_b_c_d"],
      ["starts with a digit", "1ada"],
      ["ends with a digit", "ada1"],
      ["exactly 30 characters", "a".repeat(30)],
      ["bounded by alphanumerics", "a_9_z"],
    ])("%s", (_label, input) => {
      expect(isValidHandle(input)).toBe(true);
    });
  });

  describe("rejects", () => {
    it.each([
      ["empty", ""],
      ["one character", "a"],
      ["two characters", "ab"],
      ["31 characters", "a".repeat(31)],
      ["uppercase — storage is lowercase only", "Ada"],
      ["a leading underscore", "_ada"],
      ["a trailing underscore", "ada_"],
      ["only underscores", "___"],
      // Guards against a handle reading as an internal id in a URL.
      ["all digits", "12345"],
      ["a single digit repeated", "000"],
      ["a hyphen", "ada-lovelace"],
      ["a dot", "ada.lovelace"],
      ["a space", "ada lovelace"],
      ["a slash — would forge a path segment", "ada/admin"],
      ["a percent", "ada%20"],
      ["non-latin characters", "адаловелас"],
      ["an emoji", "ada🙂"],
      ["an at sign", "@ada"],
      ["a newline", "ada\n"],
      ["a tab", "ada\t"],
    ])("%s", (_label, input) => {
      expect(isValidHandle(input)).toBe(false);
    });
  });

  /**
   * JavaScript's `$` can match before a final newline in some engines. A handle
   * that smuggled one past validation would reach a URL and a page title, so
   * this is pinned rather than assumed.
   */
  it("rejects a trailing newline after an otherwise valid handle", () => {
    expect(isValidHandle("ada\n")).toBe(false);
    expect(isValidHandle("ada\r\n")).toBe(false);
  });

  it("agrees with normalizeHandle on what a form should accept", () => {
    expect(isValidHandle(normalizeHandle("Ada Lovelace"))).toBe(false);
    expect(isValidHandle(normalizeHandle("AdaLovelace"))).toBe(true);
    expect(isValidHandle(normalizeHandle("  Ada_99  "))).toBe(true);
  });
});

describe("handleProblem", () => {
  it("returns null for a valid handle", () => {
    expect(handleProblem("ada_99")).toBeNull();
  });

  it("names the specific rule rather than saying 'invalid'", () => {
    expect(handleProblem("")).toMatch(/pick a handle/i);
    expect(handleProblem("ab")).toMatch(/at least 3/i);
    expect(handleProblem("a".repeat(31))).toMatch(/at most 30/i);
    expect(handleProblem("12345")).toMatch(/only numbers/i);
    expect(handleProblem("ada-lovelace")).toMatch(/letters, numbers and underscores/i);
    expect(handleProblem("_ada")).toMatch(/start or end with an underscore/i);
    expect(handleProblem("ada_")).toMatch(/start or end with an underscore/i);
  });

  /**
   * The two have to agree exactly, or the form and the server disagree about
   * what is submittable: a handle with a problem must be invalid, and a handle
   * with no problem must be valid.
   */
  it("agrees with isValidHandle on every case", () => {
    const cases = [
      "", "a", "ab", "abc", "ada", "ada_99", "1ada", "ada1", "000", "12345",
      "_ada", "ada_", "___", "a_b_c_d", "ada-lovelace", "ada.lovelace",
      "ada lovelace", "ada/admin", "ada%20", "Ada", "адаловелас", "ada🙂",
      "@ada", "ada\n", "ada\t", "a".repeat(30), "a".repeat(31),
    ];
    for (const input of cases) {
      expect(handleProblem(input) === null, `disagreement on "${input}"`).toBe(
        isValidHandle(input),
      );
    }
  });

  it("never returns an empty message when it rejects", () => {
    for (const input of ["", "a", "_x_", "ada-lovelace", "🙂🙂🙂"]) {
      const problem = handleProblem(input);
      expect(problem).not.toBeNull();
      expect(problem!.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from "vitest";

import { FRESH_MS, isFreshEncounter } from "./encounter";

/**
 * THIS PREDICATE IS THE ENTIRE TRIGGER RULE for opening someone's contact sheet
 * without being asked, now that /u/{handle} is a public page anyone can open.
 * There is no flag in the URL to fall back on: if this returns true when it
 * shouldn't, a stranger's phone throws up an Add Contact screen for someone they
 * merely looked at. Hence the boundary cases below rather than one happy path.
 */
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isFreshEncounter", () => {
  it("is true for a connection made moments ago", () => {
    expect(isFreshEncounter(at(0), NOW)).toBe(true);
    expect(isFreshEncounter(at(5_000), NOW)).toBe(true);
  });

  it("is true right up to the window and false at it", () => {
    expect(isFreshEncounter(at(FRESH_MS - 1), NOW)).toBe(true);
    expect(isFreshEncounter(at(FRESH_MS), NOW)).toBe(false);
    expect(isFreshEncounter(at(FRESH_MS + 1), NOW)).toBe(false);
  });

  it("is false for an ordinary visit to someone you already know", () => {
    // The case the rule exists for: a connection from last week, opened from
    // the connections list. Nothing should open by itself.
    expect(isFreshEncounter(at(7 * 24 * 60 * 60 * 1000), NOW)).toBe(false);
  });

  it("is false when there is no connection at all", () => {
    expect(isFreshEncounter(null, NOW)).toBe(false);
    expect(isFreshEncounter(undefined, NOW)).toBe(false);
    expect(isFreshEncounter("", NOW)).toBe(false);
  });

  it("is false for a timestamp it cannot read, rather than throwing", () => {
    // A corrupt or hand-written value must degrade to "not live" — the button
    // is still there, and nothing opens on its own.
    expect(isFreshEncounter("not a date", NOW)).toBe(false);
  });

  it("treats a future timestamp as just-now, not as stale", () => {
    // Clock skew between the database and the process reading it. Failing the
    // other way would break a real encounter for the sake of a few seconds.
    expect(isFreshEncounter(new Date(NOW + 3_000).toISOString(), NOW)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { buildVCard, escapeText, foldLine, vcardFilename } from "./vcard";

/** Content lines, unfolded, with the volatile REV line dropped. */
function properties(vcard: string): string[] {
  return vcard
    .replace(/\r\n /g, "") // unfold
    .split("\r\n")
    .filter((line) => line.length > 0 && !line.startsWith("REV:"));
}

describe("escapeText", () => {
  it("escapes backslash first, so escapes aren't doubled", () => {
    expect(escapeText("a\\b")).toBe("a\\\\b");
    expect(escapeText("\\,")).toBe("\\\\\\,");
  });

  it("escapes commas and semicolons", () => {
    expect(escapeText("Smith, John")).toBe("Smith\\, John");
    expect(escapeText("a;b")).toBe("a\\;b");
  });

  it("collapses CR, LF and CRLF to a single \\n escape", () => {
    expect(escapeText("a\nb")).toBe("a\\nb");
    expect(escapeText("a\rb")).toBe("a\\nb");
    // CRLF is ONE line break — treating it as two would silently alter the value
    expect(escapeText("a\r\nb")).toBe("a\\nb");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeText("Jane Doe")).toBe("Jane Doe");
  });
});

/**
 * The test §11 names explicitly: "a name containing CRLF must not produce a
 * second property". This is the attack the whole escaping layer exists for —
 * it writes an attacker-controlled phone number into the address book of every
 * person who saves the contact, under a name they trust.
 */
describe("injection resistance", () => {
  it("a CRLF in the name does not produce a second TEL property", () => {
    const vcard = buildVCard({
      name: "Jane\r\nTEL:+15550000000",
      phone: "+15551234567",
    });

    const tels = properties(vcard).filter((line) => line.startsWith("TEL"));
    expect(tels).toHaveLength(1);
    expect(tels[0]).toBe("TEL;TYPE=CELL:+15551234567");

    // The injected number is still present — but only as escaped text INSIDE the
    // FN value, never as a content line of its own. That distinction is the
    // whole point, so assert on the line structure rather than on substrings.
    expect(properties(vcard)).toContain("FN:Jane\\nTEL:+15550000000");
    expect(properties(vcard).some((line) => line.includes("+15550000000") && line.startsWith("TEL"))).toBe(false);
  });

  it("a bare LF in the name does not inject either", () => {
    const vcard = buildVCard({ name: "Jane\nEMAIL:evil@example.test" });
    expect(properties(vcard).filter((l) => l.startsWith("EMAIL"))).toHaveLength(0);
  });

  it("custom field labels and values cannot inject — they are free text by design", () => {
    const vcard = buildVCard({
      name: "Jane",
      customFields: [
        { label: "Site\r\nTEL:+15559999999", value: "example.com" },
        { label: "Note", value: "x\r\nEMAIL;TYPE=INTERNET:evil@example.test" },
      ],
    });

    const props = properties(vcard);
    expect(props.filter((l) => l.startsWith("TEL"))).toHaveLength(0);
    expect(props.filter((l) => l.startsWith("EMAIL"))).toHaveLength(0);
    expect(props.filter((l) => l.startsWith("NOTE:"))).toHaveLength(1);
  });

  it("cannot terminate the card early and append a second one", () => {
    const vcard = buildVCard({ name: "Jane\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Imposter" });
    const props = properties(vcard);
    expect(props.filter((l) => l === "BEGIN:VCARD")).toHaveLength(1);
    expect(props.filter((l) => l === "END:VCARD")).toHaveLength(1);
    expect(props.filter((l) => l.startsWith("FN:"))).toHaveLength(1);
  });

  it("a backslash-n typed literally is not treated as a line break", () => {
    // The user typed the two characters \ and n — it must survive as those two
    // characters, not become an actual escape.
    const vcard = buildVCard({ name: "Jane\\nTEL:+15550000000" });
    expect(properties(vcard)).toContain("FN:Jane\\\\nTEL:+15550000000");
    expect(properties(vcard).filter((l) => l.startsWith("TEL"))).toHaveLength(0);
  });

  it("phone and email fields are escaped too", () => {
    const vcard = buildVCard({
      name: "Jane",
      phone: "+1555\r\nNOTE:injected",
      email: "a@b.c\r\nURL:https://evil.example",
    });
    const props = properties(vcard);
    expect(props.filter((l) => l.startsWith("NOTE:"))).toHaveLength(0);
    expect(props.filter((l) => l.startsWith("URL:"))).toHaveLength(0);
  });
});

describe("structure", () => {
  it("produces a well-formed card", () => {
    const props = properties(
      buildVCard({
        name: "Jane Doe",
        phone: "+15551234567",
        email: "jane@example.test",
        bio: "Designer",
        customFields: [{ label: "Company", value: "Acme" }],
      }),
    );

    expect(props[0]).toBe("BEGIN:VCARD");
    expect(props[1]).toBe("VERSION:3.0");
    expect(props.at(-1)).toBe("END:VCARD");
    expect(props).toContain("FN:Jane Doe");
    expect(props).toContain("N:;Jane Doe;;;");
    expect(props).toContain("TEL;TYPE=CELL:+15551234567");
    expect(props).toContain("EMAIL;TYPE=INTERNET:jane@example.test");
    expect(props).toContain("NOTE:Designer\\nCompany: Acme");
  });

  it("omits properties with no value rather than emitting empty ones", () => {
    const props = properties(buildVCard({ name: "Jane", phone: null, email: null }));
    expect(props.some((l) => l.startsWith("TEL"))).toBe(false);
    expect(props.some((l) => l.startsWith("EMAIL"))).toBe(false);
    expect(props.some((l) => l.startsWith("NOTE"))).toBe(false);
  });

  it("skips custom fields with no value", () => {
    const props = properties(
      buildVCard({ name: "Jane", customFields: [{ label: "Empty", value: null }] }),
    );
    expect(props.some((l) => l.startsWith("NOTE"))).toBe(false);
  });

  it("uses CRLF line endings and ends with one", () => {
    const vcard = buildVCard({ name: "Jane" });
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard).not.toMatch(/[^\r]\n/);
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("FN:Jane")).toBe("FN:Jane");
  });

  it("folds long lines with CRLF + space", () => {
    const folded = foldLine("NOTE:" + "a".repeat(200));
    expect(folded).toContain("\r\n ");
    for (const segment of folded.split("\r\n")) {
      expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
    }
  });

  it("unfolds back to the original", () => {
    const original = "NOTE:" + "abcdefghij".repeat(30);
    expect(foldLine(original).replace(/\r\n /g, "")).toBe(original);
  });

  it("counts octets, not characters", () => {
    // Each of these is 3 bytes in UTF-8, so 40 of them exceed 75 octets while
    // being only 40 JavaScript characters.
    const line = "NOTE:" + "日".repeat(40);
    expect(line.length).toBeLessThan(75);
    expect(foldLine(line)).toContain("\r\n ");
  });

  it("never splits a surrogate pair", () => {
    const folded = foldLine("NOTE:" + "😀".repeat(40));
    for (const segment of folded.split("\r\n")) {
      expect(segment).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(segment).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(folded.replace(/\r\n /g, "")).toBe("NOTE:" + "😀".repeat(40));
  });
});

describe("vcardFilename", () => {
  it("keeps letters, numbers and spaces", () => {
    expect(vcardFilename("Jane Doe")).toBe("Jane-Doe.vcf");
  });

  it("strips path traversal and separators", () => {
    expect(vcardFilename("../../etc/passwd")).toBe("etcpasswd.vcf");
    expect(vcardFilename("a/b\\c")).toBe("abc.vcf");
  });

  it("falls back when nothing survives", () => {
    expect(vcardFilename("///")).toBe("contact.vcf");
    expect(vcardFilename("")).toBe("contact.vcf");
  });

  it("keeps non-Latin names", () => {
    expect(vcardFilename("田中太郎")).toBe("田中太郎.vcf");
  });
});

/**
 * vCard generation (§5.2).
 *
 * vCard is a LINE-BASED format, which makes string interpolation into it an
 * injection sink in exactly the way SQL or HTML is — except this one writes into
 * the victim's address book. A `name` of:
 *
 *     Jane\r\nTEL:+15550000000
 *
 * interpolated into `FN:{name}` adds an attacker-controlled phone number to the
 * contact card every connection saves, under a name they trust. Escaping here is
 * what actually makes the output well-formed; the CR/LF CHECK constraints in §3
 * are the second layer, not a substitute — they cover the columns that feed this
 * file, but custom field labels and values are free text by design and are the
 * most dangerous inputs of the lot.
 *
 * Version 3.0 rather than 4.0 is a deliberate compatibility choice. The spec
 * cites RFC 6350 (vCard 4.0) for the ESCAPING RULES, and those rules are
 * identical in RFC 2426 (3.0) — but iOS and Android both import 3.0 reliably
 * while 4.0 support is patchy, and §9 makes real-device import the bar this
 * feature has to clear.
 */

/** RFC 6350 §3.2: content lines SHOULD be folded to 75 octets, excluding CRLF. */
const MAX_OCTETS = 75;

const encoder = new TextEncoder();

/**
 * Escapes a single text value.
 *
 * Backslash MUST be replaced first, or the backslashes this function introduces
 * get escaped again on a later pass and every value comes out doubled.
 *
 * CR, LF and CRLF all collapse to a single `\n` escape — treating CRLF as two
 * separate newlines would emit `\n\n` and silently alter the value.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Folds a long content line.
 *
 * Counts UTF-8 OCTETS, not JavaScript characters — the RFC limit is in octets,
 * and a name in a non-Latin script would otherwise produce lines well over the
 * limit. Iterating with for..of walks code points, so a surrogate pair (an emoji,
 * say) is never split down the middle into two invalid halves.
 *
 * Continuation lines begin with a single space, which the parser strips when
 * unfolding — so each continuation can only carry 74 octets of payload.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = MAX_OCTETS;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = char;
      bytes = size;
      limit = MAX_OCTETS - 1; // the leading space costs one octet
    } else {
      current += char;
      bytes += size;
    }
  }
  parts.push(current);

  return parts.join("\r\n ");
}

export type VCardInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  customFields?: { label: string; value: string | null }[];
  /** Where this contact came from — becomes a URL line. */
  sourceUrl?: string | null;
};

/**
 * Builds a complete vCard.
 *
 * Every value goes through escapeText. Property NAMES and parameters are
 * hardcoded literals and never come from input, so there is no path by which
 * user data becomes a property name.
 */
export function buildVCard(input: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  const name = escapeText(input.name);
  // N is Family;Given;Additional;Prefix;Suffix. We only hold a display name, so
  // it goes in Given and FN carries the formatted form.
  lines.push(`N:;${name};;;`);
  lines.push(`FN:${name}`);

  if (input.phone) lines.push(`TEL;TYPE=CELL:${escapeText(input.phone)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeText(input.email)}`);
  if (input.photoUrl) lines.push(`PHOTO;VALUE=URI:${escapeText(input.photoUrl)}`);

  // Custom fields ride in NOTE rather than as X- properties. Arbitrary X-
  // properties are dropped silently by iOS and several Android importers, so a
  // "LinkedIn" field would simply vanish from the saved contact. NOTE is plain,
  // universally imported, and visible to the person who saved it.
  const noteParts: string[] = [];
  if (input.bio) noteParts.push(input.bio);
  for (const field of input.customFields ?? []) {
    if (field.value) noteParts.push(`${field.label}: ${field.value}`);
  }
  if (noteParts.length > 0) {
    lines.push(`NOTE:${escapeText(noteParts.join("\n"))}`);
  }

  if (input.sourceUrl) lines.push(`URL:${escapeText(input.sourceUrl)}`);

  lines.push(`REV:${new Date().toISOString().replace(/\.\d{3}/, "")}`);
  lines.push("END:VCARD");

  // CRLF between lines is required by the spec, and folding is applied per line
  // after escaping so a fold can never land inside an escape sequence in a way
  // that survives unfolding.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A filesystem-safe filename for the download / share sheet. */
export function vcardFilename(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-");
  return `${safe || "contact"}.vcf`;
}

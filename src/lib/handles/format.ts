/**
 * Handle format rules, with no dependencies.
 *
 * Deliberately separate from resolve.ts: that module imports a Supabase client,
 * and the handle form is a Client Component that needs these rules for live
 * feedback. Importing them from resolve.ts would pull `@supabase/supabase-js`
 * into the browser bundle to run a regex. (Same reasoning as
 * profile/custom-field-limits.ts.)
 *
 * These MIRROR `profiles_handle_format` in 20260802120000_handles.sql:
 *
 *   handle ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$' and handle !~ '^[0-9]+$'
 *
 * The database is the enforcement. This is a copy so the UI can reject early and
 * explain why — if the two ever disagree, the schema wins.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/;
export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 30;

/**
 * Handles are stored lowercase, so every lookup and comparison lowercases first.
 * Route params arrive already URL-decoded — decoding again here would corrupt a
 * handle containing a literal `%`, or throw on a lone one.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !/^[0-9]+$/.test(handle);
}

/**
 * The specific reason a handle is rejected, or null if it's fine.
 *
 * One message per rule rather than a single "invalid handle", because this is a
 * value the user has to invent and every rejection without a reason is a guess
 * they have to make again. Ordered most-obvious-first: a length problem is worth
 * saying before a character problem, since fixing the length may remove the
 * character too.
 */
export function handleProblem(handle: string): string | null {
  if (handle.length === 0) return "Pick a handle — it's the link people will open.";
  if (handle.length < MIN_HANDLE_LENGTH) {
    return `Handles are at least ${MIN_HANDLE_LENGTH} characters.`;
  }
  if (handle.length > MAX_HANDLE_LENGTH) {
    return `Handles are at most ${MAX_HANDLE_LENGTH} characters.`;
  }
  if (/^[0-9]+$/.test(handle)) {
    return "Handles can't be only numbers — add a letter somewhere.";
  }
  if (/[^a-z0-9_]/.test(handle)) {
    return "Use only letters, numbers and underscores.";
  }
  if (handle.startsWith("_") || handle.endsWith("_")) {
    return "Handles can't start or end with an underscore.";
  }
  // Everything the pattern rejects should be named above; this is the backstop
  // that keeps a future rule change from silently producing a blank message.
  if (!isValidHandle(handle)) return "That handle isn't allowed.";
  return null;
}

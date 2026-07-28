/**
 * Custom field limits, mirroring the constraints in §3.
 *
 * These live apart from custom-field-actions.ts because a `"use server"` module
 * may only export async functions — a plain `export const` in there is a build
 * error, not a lint nit. Keeping them here also lets the client import them for
 * `maxLength` hints without pulling a server action into the browser bundle.
 *
 * The database is the enforcement in every case: the max-count trigger, the
 * length CHECKs, and the unique index on (profile_id, lower(label)). These
 * values exist so the UI can warn early, and they are a copy — if they ever
 * disagree with the schema, the schema wins.
 */
export const MAX_CUSTOM_FIELDS = 20;
export const MAX_LABEL_LENGTH = 60;
export const MAX_VALUE_LENGTH = 500;

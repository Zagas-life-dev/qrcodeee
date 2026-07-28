# Setup

```
npm run dev         # local app
npm test            # 61 unit tests (offline, fast)
npm run lint
npm run db:migrate  # apply pending migrations
npm run db:verify   # 215 structural + behavioural checks against the real DB
```

`db:verify` runs four suites: `verify-schema` (structure and grants),
`verify-rls` (policies, as two real signed-in users), `verify-connect`
(§5.1 scan/connect edge cases) and `verify-worker` (§5.4 fan-out).

## 1. Environment

Copy `.env.example` to `.env.local` and fill it in. `NEXT_PUBLIC_SUPABASE_URL` is
the **bare** project URL (`https://<ref>.supabase.co`) — `supabase-js` appends
`/rest/v1` itself.

### DATABASE_URL must be the pooler, not the direct connection

`db.<ref>.supabase.co` resolves to **IPv6 only**. Without Supabase's paid IPv4
add-on, connecting to it from most machines fails with `ETIMEDOUT`. Use the
**session-mode pooler** instead:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Three things differ from the direct string and all three will bite:

- username is `postgres.<project-ref>`, not `postgres`
- port **5432** (session mode), not 6543 — transaction mode can't hold the
  multi-statement transactions and advisory locks migrations need
- the host is regional. This project is **`aws-0-eu-west-1`**.

Only `scripts/` uses this. The app always goes through PostgREST so RLS applies.

## 2. Apply the migrations

`npm run db:migrate` — applies pending files in filename order, one transaction
each, recording them in `supabase_migrations.schema_migrations` (the same ledger
the Supabase CLI uses, so a later `supabase db push` won't re-run them).

| File | Contents |
|---|---|
| `…120000_init_schema.sql` | `private` schema, suppression helper, 8 tables + indexes |
| `…120100_init_triggers.sql` | `updated_at`, version bumps, change events, field-count limit, signup trigger |
| `…120200_init_rls.sql` | `private` policy helpers, RLS policies, column grants, realtime publication |
| `…120300_fix_change_event_array_append.sql` | fixes a runtime failure in two change-event functions |
| `…120400_fix_change_events_on_profile_delete.sql` | fixes the hard-erasure cascade |

Order matters for the first three: the `private` policy helpers are SQL-language
functions, so Postgres parses their bodies at `CREATE` time and they reference
`blocks` / `connections`.

## 3. Dashboard configuration

### Settings → API → Exposed schemas — **verified passing**

Must list `public` and `graphql_public`, and **must not list `private`**.

The helpers in `private` are `SECURITY DEFINER`; they read past RLS by design.
PostgREST publishes every function in an exposed schema as `POST /rpc/<name>`
with EXECUTE granted to PUBLIC. If `private` were exposed, any user could call
`/rpc/is_blocked` with arbitrary arguments to ask whether any two people have
blocked each other, and `/rpc/has_active_connection` to enumerate the private
social graph one pair at a time. There is no error and no log line if this is
wrong — `db:verify` probes the live HTTP endpoint to confirm it.

### Authentication → Providers → Google — configured

In Google Cloud Console the authorised redirect URI is Supabase's callback, not
ours: `https://<ref>.supabase.co/auth/v1/callback`. That's why the consent screen
says "signing you in to `<ref>.supabase.co`". To show your own domain there, add
a custom auth domain (Supabase Pro) — cosmetic, not blocking.

### Authentication → URL Configuration → Redirect URLs

```
http://localhost:3000/auth/callback
https://<your-vercel-domain>/auth/callback
```

Missing entries surface as a redirect to `/auth/auth-code-error`.

## 4. Database types

`src/lib/supabase/database.types.ts` is **hand-maintained**. `supabase gen types`
runs `postgres-meta` in a container and needs Docker/Podman, which isn't
available on this machine.

The hand-written version is also deliberately narrower than generated output:
`profiles.Update` exposes only `name`/`photo_url`/`bio`/`qr_style`, matching the
column grants, so writing `profile_version` is a *compile* error rather than a
runtime RLS rejection. Generated output reports every column as writable.

`db:verify` fails if a column exists in the database but not in this file, so
drift gets caught rather than discovered later.

## 5. Two bugs the verification caught

Both were in the build spec's own SQL, and neither is visible in a structural
check — the function definitions are valid until a row flows through them.

**1. `changed := changed || 'name'` aborted every profile edit.** `changed` is
`text[]` and `'name'` is an untyped literal, so Postgres resolved the operator to
`anyarray || anyarray` and tried to parse `'name'` as an array literal:
`malformed array literal: "name"`. Every name/photo/bio and phone/email edit
failed. Fixed with `array_append`, which has one unambiguous overload.

**2. Hard-deleting an account aborted on a NOT NULL violation.** Deleting
`auth.users` cascades to `profiles` and on to `custom_fields`, whose DELETE
trigger then does `update profiles ... returning profile_version` against a row
that is already gone. `new_version` came back NULL and the change-event insert
failed. §8 requires the GDPR erasure pipeline to work, so the triggers now treat
a missing profile as "nothing to version, nobody to notify" and bail.

## 6. The notification worker (§5.4)

`POST /api/worker/notifications`, authenticated with `WORKER_SECRET` as either
`Authorization: Bearer <secret>` or an `x-worker-secret` header. It **fails
closed** — with no secret configured it returns 503 rather than running, because
an open worker endpoint is a notification-spam amplifier that fans out to every
connection of every pending profile.

Two triggers, and both are wanted:

- **Supabase Database Webhook** on `profile_change_events` INSERT — the
  low-latency path. Dashboard → Database → Webhooks, HTTP POST to the route with
  the `x-worker-secret` header.
- **Cron** (`vercel.json`) — the safety net. A crashed run deliberately leaves
  events unprocessed so the next pass redoes them, which is safe because of the
  idempotency index and the monotonic watermark. Minute-level crons need a paid
  Vercel plan; on Hobby this degrades to daily and the webhook carries delivery.

Set `CRON_SECRET` in Vercel to the same value as `WORKER_SECRET` — Vercel Cron
sends its own secret as the bearer token.

The batching logic is in SQL (`process_change_batch`), not in the route handler.
§5.4 requires a per-profile advisory lock and one transaction per batch, and
PostgREST gives one transaction per request with no way to hold a lock across
statements — so a JavaScript implementation could honour neither. In SQL, one
call *is* one transaction, which makes the lock and the batch boundary the same
thing.

## 7. What `db:verify` covers

**Structural (83)** — table/RLS presence, policy shape, that no policy inlines a
`blocks` subquery, column-level UPDATE grants, `private` function security
attributes and per-role grants, that **no function in `public` is executable by
`anon`**, trigger `WHEN` clauses, partial index predicates, realtime publication
membership, and type drift against `database.types.ts`.

**Behavioural (58)**, driven through PostgREST as two real signed-in users
rather than as `postgres` — which bypasses every policy and would pass
regardless: signup trigger output, that profile edits succeed at all,
connection-gating of `contact_details`, **that the blocked party (not just the
blocker) loses visibility**, the `photo_url` host allowlist, custom-field limits
and visibility, the reorder RPC's scoping, push-subscription device transfer, no
client writes to `connections`/`notifications`/`profile_change_events`, and the
hard-erasure cascade.

**Scan/connect (46)** — every §5.1 branch: self-scan, invalid token, first
connection with **non-swapped watermarks** (the two profiles are put on
different versions first, so a reversed a/b mapping is detectable), the
`new_connection` notification going only to the scanned person, reconnect
reactivating the same row with a bumped epoch and a second notification,
`blocked` vs `invalid_token` in both directions, soft-deleted targets, token
rotation, and simultaneous scans producing exactly one row.

**Worker (28)** — a/b slot mapping in *both* directions, idempotent re-runs, the
minor-change threshold **including that a below-threshold change leaves the
watermark alone** so the gap keeps accumulating, `greatest()` refusing to walk a
watermark backwards, the advisory lock making a second overlapping run back off,
disconnected and blocked pairs receiving nothing, and the worker RPCs being
unreachable by `anon` and `authenticated`.

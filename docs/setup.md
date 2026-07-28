# Setup

```
npm run dev         # local app
npm test            # 61 unit tests (offline, fast)
npm run lint
npm run db:migrate  # apply pending migrations
npm run db:verify   # 311 structural + behavioural checks against the real DB
```

`db:verify` runs seven suites: `verify-schema` (structure and grants),
`verify-rls` (policies, as two real signed-in users), `verify-connect` (§5.1
scan/connect edge cases), `verify-worker` (§5.4 fan-out), `verify-moderation`
(§5.6 disconnect/block/report), `verify-rate-limits` (§7) and `verify-deletion`
(§8 deletion + retention).

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

### Deploying: `NEXT_PUBLIC_*` is a build input, not a runtime one

`.env.local` covers local dev only. On Vercel the same values go in **Settings →
Environment Variables**, and the three below must exist **on the Production
environment before the build runs**:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL      # https://<your-vercel-domain>, no trailing slash
```

Next inlines `NEXT_PUBLIC_*` into the bundle at `next build` rather than reading
it from `process.env` at request time. Two consequences that both look like
application bugs:

- Adding a variable in the dashboard does nothing to the deployment already
  serving traffic. **Redeploy.**
- A variable scoped only to Preview/Development is *absent* in Production, even
  though the dashboard shows it right there in the list.

`next.config.ts` fails the build if any of the three is missing, so this surfaces
as a red deploy naming the variable. It used to surface as a 500 with nothing but
a digest: `NEXT_PUBLIC_SITE_URL` is read by `siteUrl()`, which only runs when
someone clicks *Continue with Google* (§5.1) or loads their QR (§6) — so the site
came up fine and only sign-in was dead.

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is checked too but only warns: without it push
reports itself unsupported and the rest of the app is unaffected.

## 2. Apply the migrations

`npm run db:migrate` — applies pending files in filename order, one transaction
each, recording them in `supabase_migrations.schema_migrations` (the same ledger
the Supabase CLI uses, so a later `supabase db push` won't re-run them).

| File | Contents |
|---|---|
| `…120000_init_schema.sql` | `private` schema, suppression helper, core tables + indexes |
| `…120100_init_triggers.sql` | `updated_at`, version bumps, change events, field-count limit, signup trigger |
| `…120200_init_rls.sql` | `private` policy helpers, RLS policies, column grants, realtime publication |
| `…1203/1204_fix_*.sql` | two runtime bugs in the spec's SQL — see §5 below |
| `…13/14xxxx_*.sql` | photo_url host allowlist, custom-field reorder RPC |
| `…15/16xxxx_*.sql` | `connect_via_scan`, `rotate_qr_token`, anon grant revokes |
| `…17xxxx_*.sql` | push subscriptions + registration RPC |
| `…18xxxx_*.sql` | §5.4 fan-out worker, contact-save timestamps |
| `…19xxxx_*.sql` | §5.6 disconnect + `list_blocked` |
| `…20xxxx_*.sql` | §7 rate limiting (table, helper, triggers, scan limits) |
| `…21xxxx_*.sql` | §8 account deletion, retention, connection search |

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

### Telling the Google sign-in failures apart

They fail at different points in the round trip, which is the fastest way to
narrow it down:

| Symptom | Cause |
|---|---|
| Back on `/login`, "We couldn't start the Google sign-in" | Never reached Google. Search the Vercel runtime logs for `oauth_start_failed` — the `reason` field names it. |
| Google's own screen says `redirect_uri_mismatch` | Google Cloud Console is missing `https://<ref>.supabase.co/auth/v1/callback`. |
| Returns to `/auth/auth-code-error` | Supabase **Redirect URLs** is missing this origin's `/auth/callback`, or the code was already used. |
| Lands on `localhost` after consent | `NEXT_PUBLIC_SITE_URL` was built with the dev value. |

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

### Delivery on Vercel Hobby

**Vercel reads cron schedules from `vercel.json` at deploy time, so no
environment variable can change *when* a cron fires** — and Hobby caps crons at
once per day, so a minutely expression simply won't run. Delivery therefore does
not depend on cron at all. Three paths, in order of importance:

1. **In-app trigger** (`src/lib/notifications/trigger.ts`) — the moment someone
   saves a profile or custom field, their events are fanned out inside
   `after()`. The user's save returns immediately; the connection hears about a
   changed phone number about a second later. **This is what makes Hobby feel
   live.** Nothing to configure.
2. **Supabase Database Webhook** on `profile_change_events` INSERT — catches
   anything written outside the app (SQL editor, admin tooling). Dashboard →
   Database → Webhooks → HTTP POST to
   `/api/worker/notifications?force=1` with an `x-worker-secret` header. Free and
   outside the cron limit.
3. **Daily cron** — the safety net. A crashed run leaves events unprocessed by
   design so the next pass redoes them, which is safe because of the idempotency
   index and the monotonic watermark.

Set `CRON_SECRET` in Vercel to the same value as `WORKER_SECRET` — Vercel Cron
sends its own secret as the bearer token.

### The `WORKER_MODE` switch

Controls what each invocation **does**, since the schedule itself is fixed.

| Value | Behaviour |
|---|---|
| `continuous` (default) | Run on every hit, draining for up to 45s. |
| `weekly` | Only do work on `WORKER_WEEKLY_DAY` (0=Sunday, default 1=Monday); no-op the other six days, returning in milliseconds. |
| `off` | Never run. **Beats `?force=1`** — a stop switch some callers can override isn't a switch. |

`?force=1` bypasses the weekly gate, which is why the webhook uses it: a webhook
only fires because an event was just written, so there is genuinely work to do.

An unrecognised value falls back to `continuous`, deliberately — a typo that
silently stops delivering notifications is a far worse failure than one that
delivers them.

Both worker routes honour the switch. Changing it in the Vercel dashboard needs a
redeploy to take effect.

The batching logic is in SQL (`process_change_batch`), not in the route handler.
§5.4 requires a per-profile advisory lock and one transaction per batch, and
PostgREST gives one transaction per request with no way to hold a lock across
statements — so a JavaScript implementation could honour neither. In SQL, one
call *is* one transaction, which makes the lock and the batch boundary the same
thing.

## 7. Rate limiting (§7)

Two layers, and they are not equally trustworthy.

**Database-backed, per actor — this is the real one.** A `rate_events` table with
RLS on and *zero* policies, checked and appended inside the RPCs and triggers
that already gate every write. It survives restarts and is shared across every
serverless instance, which is precisely what an in-memory counter gets wrong.

| Limit | Cap | Where |
|---|---|---|
| Scans | 30/min | `connect_via_scan`, before the token is even resolved |
| Failed scans, per user | 15/hour | enumeration signal |
| Failed scans, per token | 30/hour across all users | hammering a rotated-out code |
| New connections | 60/hour | both the new and reactivate paths |
| Profile mutations | 60/hour | triggers on profiles / contact_details / custom_fields |
| Reports | 10/hour | trigger on reports |
| Token rotation | 10/hour | `rotate_qr_token` |

Two exemptions, both load-bearing: a **null actor** (signup trigger, notification
worker, retention jobs) and the **`app.suppress_change_events` flag**. Without the
second, account deletion — which removes every custom field in one transaction —
would look like abuse and a user could be locked out of deleting their own
account.

**Per-IP at the edge — a speed bump, not a control.** `src/proxy.ts` limits
`/connect/`, `/api/avatar/sign` and `/api/contacts/` per IP. §7 is explicit that
in-memory counters in a serverless function get limits wrong, and this is one:
state is per-instance, so N warm instances means N times the allowance, and a
cold start resets the window. It exists because nothing in front of the scan
endpoints is worse. **The real answer at scale is a WAF rule or Vercel's own IP
rate limiting, configured outside the app.**

### Two things that would break the product if done naively

- **Per-token limits count failed attempts only.** A QR code on a conference
  badge scanned by fifty people in ten minutes is the success case. Capping
  successful scans per token would start refusing legitimate connections exactly
  when the app is working.
- **Reordering costs zero mutation budget.** One drag rewrites `sort_order` on up
  to 20 rows. The rate triggers carry the same `sort_order` exclusion as the
  change-event triggers, or three drags would exhaust an hourly budget of 60.
  Both are asserted in `verify-rate-limits`.

## 8. Account deletion (§8)

`delete_my_account()` — soft delete only. The `profiles` row survives, scrubbed
(`name = 'Deleted account'`, photo/bio cleared, `qr_token` rotated), so other
people's connection history resolves to a placeholder rather than a broken
reference. `on delete cascade` does none of this: it fires on a row DELETE, and
this is an UPDATE, so every step is explicit.

`set_config('app.suppress_change_events','on',true)` is the **first statement and
not optional**. Without it, deleting your account fans out "they changed their
phone and email" to every connection you ever had, and offers each of them the
one-tap "Update phone contact" action that rewrites their address book entry to
read `Deleted account`. It also exempts the transaction from the §7 mutation
limit — a bulk delete of 20 custom fields otherwise looks like abuse.

**The flow also bans the auth user.** §8 says never to touch `auth.users`,
because deleting it cascades away the placeholder — but leaving the record fully
active means a "deleted" user just signs in again to an empty shell. Banning
disables sign-in without removing the row, which is the only option satisfying
both constraints.

**Connections are left ACTIVE** (§8 step 5, a decision the spec leaves open). The
placeholder is the whole point of the design; disconnecting would throw away the
history it exists to serve. The per-connection Disconnect action is offered for
deleted accounts so anyone who wants it gone can remove it themselves.

### Retention

`POST /api/worker/retention` (same `WORKER_SECRET`, daily cron in `vercel.json`).
Prunes processed change events >90d, read notifications >180d, and rate_events
>1d. **Unprocessed change events are never pruned regardless of age** — they are
the worker's backlog, and deleting one silently drops a notification. Every
delete is batched; the route loops until the backlog drains.

One thing to watch: §8 says keep unread notifications until read, which is
unbounded. A user who never opens the app accumulates rows forever. Following the
spec, but it's the table most likely to surprise you at 100k MAU.

## 9. Observability (§9)

`GET /api/health` — unauthenticated returns `{ok, db}` for uptime monitors;
with the worker secret it adds queue depths.

`pendingEvents` is the number §9 wants an alert on. `oldestPendingAgeSeconds` is
the more useful one: a backlog of 5 that is two hours old means the worker isn't
running at all, which a small count alone would hide. `prunableRateEvents` being
non-zero means the retention cron isn't firing.

Worker routes emit one JSON object per line (`src/lib/observability.ts`) so log
search can answer §9's questions. **This is not an APM.** Latency histograms,
alerting and dashboards still need real tooling — this gives you the event
stream to build them from.

## 10. What `db:verify` covers

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

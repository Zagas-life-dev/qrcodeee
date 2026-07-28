# QR Connect — Build Specification

## 1. Product Overview

QR Connect is a zero-friction contact-sharing and connection-tracking app. Every user
has a personal QR code. When one user scans another's code, a mutual connection is
created automatically — no approval step, no manual "add back." Each side is guided
through saving the other's contact (the scanner and the scanned person go through
*different* flows — see §5.2), the connection is logged into an in-platform contact
list, and every user has a public profile page showing their details and a history of
everyone they've connected with.

**Core principles for this build:**
- Scanning is the only action a user takes. Everything else (mutual connect, save
  prompts, history logging) happens automatically off the back of that one scan.
- Connection history is a **live pointer**, not a frozen snapshot — if someone
  updates their profile after connecting, everyone who's connected to them sees the
  updated info, not what was true at scan time. Missing/removed fields render as
  empty/"Not provided," never as an error.
- Users get notified when someone they're connected to changes something important,
  so they know to refresh their saved contact.
- **Never overclaim what actually happened.** A browser/PWA can't confirm a contact
  was written to the native address book — say "ready to save" / "open Add Contact,"
  never "saved," unless it's demonstrably true.
- **Terminology:** call it a "connection" and describe it plainly ("you exchanged
  contact info") — avoid borrowing language like "friend request" or "follow" that
  implies an approval step this product doesn't have.

> **Build order matters here.** Steps 1–4 in §11 (auth → profile → QR/scan/connect →
> contact save) ARE the product. Step 5 (async notifications) is real and worth
> building right, but get the core loop fully working and tested first — don't let
> notification infrastructure delay a working connect-and-save experience.

## 2. Tech Stack

- **Auth + Database:** Supabase (Postgres + Supabase Auth, Google OAuth enabled).
  RLS enforced at the database level — no fallback on app-level permission checks.
- **Frontend + Hosting:** Next.js on Vercel, built and shipped as a PWA (web app
  manifest + service worker) so users can install it to their home screen. No
  native mobile app for now — see §10 for what that unlocks later.
- **Media:** Cloudinary for profile photo storage/transforms.
- **Target scale:** 100,000 MAU. Free tier will not cover this (50k MAU cap,
  500MB DB) — plan to be on the Pro plan ($25/mo base) from early production,
  budgeting toward $50–100+/mo as usage grows. Treat that price as a floor, not
  a forecast — real cost depends heavily on Realtime connections, storage,
  bandwidth, and notification volume. Build a rough capacity estimate (MAU ×
  sessions × scans × notification events) and load-test against it before
  assuming the plan price predicts total spend.

## 3. Data Model

```sql
-- Helper functions live here, NOT in public. PostgREST exposes every function
-- in an exposed schema as POST /rpc/<name>, and CREATE FUNCTION grants EXECUTE
-- to PUBLIC by default — so a SECURITY DEFINER predicate sitting in `public`
-- becomes a callable oracle that answers the exact question its RLS policy
-- exists to hide (§4 has the concrete case). Keep `private` out of the API's
-- exposed-schema list; policy evaluation still works because `authenticated`
-- gets USAGE + EXECUTE, it just isn't reachable over HTTP.
create schema if not exists private;
grant usage on schema private to authenticated;

-- Change-event suppression, checked by all three change-event triggers below.
-- Account deletion (§8) rewrites name, clears photo/bio, and deletes
-- contact_details + custom_fields — every one of which is indistinguishable
-- from an ordinary edit to a trigger. Without this guard, deleting your account
-- fans out "they changed their phone and email" plus "they changed their name"
-- to every connection you ever had, and offers each of them the one-tap
-- "Update phone contact" action from §5.7 that rewrites their address book to
-- read "Deleted account". `set local` in the deletion RPC scopes the flag to
-- one transaction, so it can never leak into another session.
create or replace function private.change_events_suppressed() returns boolean as $$
  select coalesce(current_setting('app.suppress_change_events', true), 'off') = 'on';
$$ language sql stable;

-- Profiles: one row per user, linked 1:1 to Supabase auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  -- Length caps and the newline ban are not cosmetic: name and bio are
  -- interpolated into a generated .vcf (§5.2), and vCard is a line-based
  -- format, so an embedded CR/LF injects arbitrary properties into a file every
  -- connection saves to their address book. Escaping at generation time is the
  -- real fix; this is the second layer.
  name text not null
    check (char_length(name) between 1 and 100)
    check (strpos(name, chr(10)) = 0 and strpos(name, chr(13)) = 0),
  photo_url text check (char_length(photo_url) <= 2048),
  bio text check (char_length(bio) <= 500),
  qr_token text unique not null default gen_random_uuid()::text,
  qr_style jsonb not null default '{}'::jsonb
    check (pg_column_size(qr_style) <= 4096),
  profile_version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- qr_style holds the user's QR customization, e.g.:
-- {"dotColor":"#1a1a2e","backgroundColor":"#ffffff",
--  "dotStyle":"rounded","cornerStyle":"extra-rounded","logoUrl":"..."}
-- Kept separate from qr_token so regenerating the token (privacy reset)
-- doesn't wipe out the user's chosen styling.
-- profile_version increments only for fields that count as a "relevant
-- change" — see the table in §5.4. qr_token/qr_style changes do NOT bump it.
-- deleted_at supports soft-delete on account deletion — see §8 for an
-- important caveat about the auth.users cascade above.

-- auto-maintain updated_at on every row update (enforced at the DB level)
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- BEFORE UPDATE: bump profile_version in-place on NEW (no extra UPDATE
-- statement, so this can't recursively re-fire itself), only when a
-- version-relevant column actually changed.
create or replace function bump_profile_version() returns trigger as $$
begin
  new.profile_version := old.profile_version + 1;
  return new;
end;
$$ language plpgsql;

create trigger profiles_bump_version
  before update on profiles
  for each row
  when (new.name is distinct from old.name
     or new.photo_url is distinct from old.photo_url
     or new.bio is distinct from old.bio)
  execute function bump_profile_version();

-- AFTER UPDATE: log the change event using the version the BEFORE trigger
-- already set on NEW — never re-reads profile_version at some later point,
-- which is what avoids a race between overlapping updates.
--
-- SECURITY DEFINER here is REQUIRED, not hardening. profile_change_events has
-- RLS enabled with no policies at all (§4), and a plain trigger function runs
-- with the calling user's privileges — so this insert would be rejected and
-- *every profile update would fail*. Same applies to the contact_details and
-- custom_fields change-event functions below. Create them in a migration so
-- they're owned by `postgres` (which bypasses RLS), and pin search_path on all
-- of them so a schema on the caller's path can't hijack name resolution.
create or replace function log_profile_change_event() returns trigger as $$
declare
  changed text[] := array[]::text[];
  major boolean := false;
begin
  if private.change_events_suppressed() then return null; end if;
  if new.name is distinct from old.name then changed := changed || 'name'; major := true; end if;
  if new.photo_url is distinct from old.photo_url then changed := changed || 'photo_url'; end if;
  if new.bio is distinct from old.bio then changed := changed || 'bio'; end if;
  if array_length(changed, 1) is null then return null; end if;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (new.id, new.profile_version, changed, major);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger profiles_log_change_event
  after update on profiles
  for each row
  when (new.profile_version is distinct from old.profile_version)
  execute function log_profile_change_event();
-- Worth knowing: the contact_details and custom_fields triggers below bump
-- profiles.profile_version with their own UPDATE, which re-fires this trigger
-- (the version did change). That is safe but only by construction — the
-- function finds no name/photo_url/bio diff and bails before inserting, so
-- there's no duplicate event. Don't relax that early return, and don't widen
-- the WHEN clause above to fire on any update, or those cross-table bumps
-- start double-logging.

-- Contact details: phone/email, split out so they can be connection-gated
-- by RLS instead of publicly readable like the rest of the profile. Keep
-- this table to phone/email only — route everything else (WhatsApp,
-- LinkedIn, job title, company, etc.) through custom_fields instead of
-- adding a dedicated column per platform.
create table contact_details (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- Same vCard reasoning as profiles.name — these two land in TEL: and EMAIL:
  -- lines verbatim, so a newline here injects properties into the saved contact.
  phone text
    check (char_length(phone) <= 40)
    check (strpos(phone, chr(10)) = 0 and strpos(phone, chr(13)) = 0),
  email text
    check (char_length(email) <= 320)
    check (strpos(email, chr(10)) = 0 and strpos(email, chr(13)) = 0),
  updated_at timestamptz not null default now()
);

create trigger contact_details_set_updated_at
  before update on contact_details
  for each row execute function set_updated_at();

-- contact_details lives on a separate table from profiles, so it can't use
-- the same "bump NEW in a BEFORE trigger" trick — it atomically increments
-- profiles.profile_version itself via UPDATE ... RETURNING, which is safe
-- under concurrent writes. Phone/email changes are always major.
--
-- Fires on INSERT and DELETE too, not just UPDATE. An UPDATE-only trigger
-- misses the most common real case there is: a user who signs up without a
-- phone number, connects with people, and *then* adds one. That's the single
-- most notification-worthy change in the product, and UPDATE-only silently
-- drops it. (§4 creates the contact_details row at signup, so most edits will
-- in fact be UPDATEs — but don't depend on that being the only path.)
--
-- Note the TG_OP branching rather than coalesce(new.phone, old.phone)-style
-- shorthand: in PL/pgSQL, OLD is not a usable record in an INSERT trigger (nor
-- NEW in a DELETE trigger), so reaching for the wrong one is an error, not a
-- null.
create or replace function log_contact_details_change_event() returns trigger as $$
declare
  changed text[] := array[]::text[];
  new_version int;
  pid uuid;
begin
  if private.change_events_suppressed() then return null; end if;
  if tg_op = 'INSERT' then
    pid := new.profile_id;
    if new.phone is not null then changed := changed || 'phone'; end if;
    if new.email is not null then changed := changed || 'email'; end if;
  elsif tg_op = 'DELETE' then
    pid := old.profile_id;
    if old.phone is not null then changed := changed || 'phone'; end if;
    if old.email is not null then changed := changed || 'email'; end if;
  else
    pid := new.profile_id;
    if new.phone is distinct from old.phone then changed := changed || 'phone'; end if;
    if new.email is distinct from old.email then changed := changed || 'email'; end if;
  end if;
  if array_length(changed, 1) is null then return null; end if;

  update profiles set profile_version = profile_version + 1
    where id = pid
    returning profile_version into new_version;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (pid, new_version, changed, true);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger contact_details_log_change_event
  after insert or update or delete on contact_details
  for each row execute function log_contact_details_change_event();

-- Custom fields: user-added rows, with basic abuse/quality limits built in
create table custom_fields (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null check (char_length(label) <= 60),
  value text check (char_length(value) <= 500),
  is_public boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index custom_fields_unique_label_per_profile
  on custom_fields (profile_id, lower(label));
create index custom_fields_profile_idx on custom_fields (profile_id, sort_order);
-- Never render `value` as raw HTML on the frontend — always treat as plain
-- text — and escape it when generating the .vcf (§5.2), same as name/phone.

-- The max-field-count limit has to live HERE, not "in application logic". The
-- client talks to Postgres directly under the `for all using (profile_id =
-- auth.uid())` policy in §4, so any app-level cap is advisory — a scripted
-- client can insert unboundedly. That isn't just a data-quality problem: every
-- insert bumps profile_version and writes a change event, and every event fans
-- out to all of that user's connections, so an unenforced cap is a
-- notification amplification vector.
--
-- The `for update` on the profile row is what makes the count exact. A plain
-- count-then-insert lets two concurrent inserts both observe 19 and both
-- proceed; taking the row lock first serializes inserts per profile. It adds no
-- new contention, because the change-event trigger takes that same row lock a
-- moment later anyway. SECURITY DEFINER so it can take the lock despite the
-- narrowed column grants in §4, and so the count sees every row regardless of RLS.
create or replace function enforce_custom_field_limit() returns trigger as $$
declare
  n int;
begin
  perform 1 from profiles where id = new.profile_id for update;
  select count(*) into n from custom_fields where profile_id = new.profile_id;
  if n >= 20 then
    raise exception 'custom field limit of 20 reached'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger custom_fields_enforce_limit
  before insert on custom_fields
  for each row execute function enforce_custom_field_limit();

create trigger custom_fields_set_updated_at
  before update on custom_fields
  for each row execute function set_updated_at();

-- Custom field changes are always treated as minor — deliberately NOT
-- prioritized by the user-created label (arbitrary text like "Company" vs.
-- "company" vs. "Company Name" isn't reliable input to hang notification
-- logic on). If per-field priority is wanted later, revisit deliberately —
-- don't guess from labels.
-- Two things this must NOT do:
--   * bump the version on a pure reorder. Dragging fields around rewrites
--     sort_order on up to 20 rows, and an unfiltered row trigger turns that
--     one gesture into 20 version bumps and 20 change events.
--   * bump the version for a field that is private both before AND after the
--     change. Connections can't see it (§4), so notifying them amounts to
--     "they changed something you're not allowed to see" — noise plus a small
--     leak. A visibility flip in either direction DOES count: the field
--     genuinely appears or disappears for them.
create or replace function log_custom_field_change_event() returns trigger as $$
declare
  new_version int;
  pid uuid;
begin
  if private.change_events_suppressed() then return null; end if;
  if tg_op = 'INSERT' then
    if not new.is_public then return null; end if; -- nobody else could see it
    pid := new.profile_id;
  elsif tg_op = 'DELETE' then
    if not old.is_public then return null; end if;
    pid := old.profile_id;
  else
    if not new.is_public and not old.is_public then return null; end if;
    pid := new.profile_id;
  end if;

  update profiles set profile_version = profile_version + 1
    where id = pid
    returning profile_version into new_version;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (pid, new_version, array['custom_field'], false);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Any row appearing or disappearing is a change; the function filters private ones.
create trigger custom_fields_log_insert_delete_event
  after insert or delete on custom_fields
  for each row execute function log_custom_field_change_event();

-- UPDATE: only label/value/visibility count — sort_order is deliberately
-- absent, which is what makes reordering free. This can't be folded into the
-- trigger above: Postgres rejects a WHEN clause referencing OLD on an INSERT
-- trigger, so the two cases need separate CREATE TRIGGER statements.
create trigger custom_fields_log_update_event
  after update on custom_fields
  for each row
  when (new.label is distinct from old.label
     or new.value is distinct from old.value
     or new.is_public is distinct from old.is_public)
  execute function log_custom_field_change_event();

-- Connections: one row per mutual connection, with per-direction notification tracking
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz, -- soft delete — see §5.6
  -- Incremented on every (re)activation. Exists so that a disconnect →
  -- reconnect cycle can produce a *second* new_connection notification: the
  -- idempotency index on `notifications` would otherwise treat the pair as
  -- already-notified forever and silently drop it. See the note there.
  connection_epoch int not null default 1,
  -- Notification watermarks. Deliberately NO default: connect_via_scan must
  -- set each side to the OTHER person's current profile_version at connect
  -- time. `default 1` is the trap — connecting to a profile already at version
  -- 47 would start you 46 versions behind, so their next trivial bio edit
  -- instantly trips the accumulated-changes threshold and fires a "they
  -- updated their info" notification about 46 changes that all happened before
  -- you ever met them. Same rule on reactivation (§5.1). Omitting the default
  -- makes forgetting this a NOT NULL violation instead of a silent bug.
  a_notified_version int not null, -- version of B's profile A has been notified up to
  b_notified_version int not null, -- version of A's profile B has been notified up to
  constraint no_self_connection check (user_a <> user_b)
);
-- The unique index matches on the pair regardless of active/inactive state —
-- reconnecting after a disconnect must REACTIVATE this row, not insert a new
-- one. See §5.1 for the explicit reactivation logic connect_via_scan needs.
create unique index unique_connection_pair
  on connections (least(user_a, user_b), greatest(user_a, user_b));
create index connections_user_a_idx on connections(user_a);
create index connections_user_b_idx on connections(user_b);

-- Blocks and reports — schema exists from day one even if the UI ships later
create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_id uuid not null references profiles(id) on delete cascade,
  category text not null check (category in
    ('spam','harassment','impersonation','inappropriate','scam','other')),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz, -- set by moderation, not by the reporter
  constraint no_self_report check (reporter_id <> reported_id)
);
-- One OPEN report per pair. A flat unique (reporter_id, reported_id) stops the
-- spam case but also permanently bars a legitimate second report — A reports B
-- for spam in 2026, that case is closed, B harasses A in 2028, and A can never
-- file again. Partial index gets both: can't pile on an open case, can open a
-- new one after the last was resolved.
create unique index reports_one_open_per_pair
  on reports (reporter_id, reported_id) where resolved_at is null;
-- This constrains a single pair only. Per-reporter volume ACROSS targets (one
-- account filing 500 reports against 500 different people) is not addressed
-- here and still needs the rate limit in §7.

-- Profile change events: lightweight, written by the trigger functions
-- above, processed async by a background worker
create table profile_change_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  version int not null,
  changed_fields text[] not null, -- field NAMES only — never old/new values (privacy)
  is_major boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz -- set by the background worker once fanned out
);
-- This is the highest-write table in the system and it has exactly two access
-- patterns; both need an index or they seq-scan all of history.
-- 1. The worker's claim query: unprocessed events for one profile, in version
--    order. Partial on `processed_at is null` so the index stays the size of
--    the live backlog (normally near-zero), not the size of the table.
create index profile_change_events_pending_idx
  on profile_change_events (profile_id, version) where processed_at is null;
-- 2. The retention job in §8, which prunes by processed_at.
create index profile_change_events_processed_idx
  on profile_change_events (processed_at) where processed_at is not null;

-- Notifications: structured, not a fixed string, with an idempotency guarantee
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('major_change','accumulated_changes','new_connection')),
  -- NOT NULL on purpose: NULLs are never equal to each other in a unique
  -- index, so a nullable column in the idempotency key below would silently
  -- switch the whole guarantee off for any row that happened to have one.
  -- Cascades to match recipient_id — asymmetric FK actions here would make the
  -- deliberate hard-erasure pipeline in §8 fail on a foreign key violation.
  source_profile_id uuid not null references profiles(id) on delete cascade,
  -- DISPLAY value: which version of the source profile this was about. Null for
  -- new_connection, which isn't about a version at all. The frontend may show
  -- it; nothing keys on it.
  change_version int,
  -- DEDUPE value: the only thing the idempotency index keys on. Split from
  -- change_version rather than overloading it, because the two answer different
  -- questions and conflating them is what broke the original design:
  --   major_change / accumulated_changes → the source's profile_version
  --   new_connection                     → connections.connection_epoch
  -- With a single nullable change_version, every new_connection row keyed on
  -- the same coalesced sentinel, so the index permitted exactly ONE
  -- new_connection notification per (recipient, source) for the lifetime of the
  -- account — a disconnect/reconnect (§5.1) would hit `do nothing` and the
  -- scanned person would never be told. Keying on connection_epoch instead
  -- makes each reactivation genuinely distinct.
  dedupe_seq int not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
-- One notification per (recipient, source, type, dedupe_seq) — safe against
-- worker retries and duplicate/overlapping worker runs (§5.4). All four are
-- plain NOT NULL columns, so ON CONFLICT inference is unambiguous: no
-- expression index to match, and no need for a generated column. Note ON
-- CONFLICT cannot be handed an index NAME — `on conflict
-- (notifications_idempotency)` is a syntax error, and `on conflict on
-- constraint` only accepts real constraints, which CREATE UNIQUE INDEX doesn't
-- produce. Write the column list:
--   insert into notifications
--     (recipient_id, source_profile_id, type, change_version, dedupe_seq)
--   values (...)
--   on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
create unique index notifications_idempotency
  on notifications (recipient_id, source_profile_id, type, dedupe_seq);
-- Unread badge (§5.5). Partial, so it stays proportional to unread count rather
-- than to total notification history.
create index notifications_unread_idx
  on notifications (recipient_id) where read_at is null;
-- The notification list itself, newest first.
create index notifications_recipient_created_idx
  on notifications (recipient_id, created_at desc);
```

## 4. Row-Level Security

**Resolved:** name and photo are always public — not user-toggleable. Phone and
email are connection-gated: only visible to someone once an active connection
exists between them and the profile owner. Custom fields keep their own
per-field `is_public` toggle as before. This is enforced at the table level —
public identity fields live on `profiles`, connection-gated contact fields live
on `contact_details` — rather than trying to filter columns within one policy.

Blocking is enforced bidirectionally at this same level: once either side has
blocked the other, `profiles`, `contact_details`, `custom_fields`, and
`connections` all stop being visible to the other side — it doesn't matter who
blocked whom.

> **The trap that makes bidirectional blocking silently one-directional.** A
> policy expression that reads another table is *itself* subject to that
> table's RLS. `blocks` only exposes rows where `blocker_id = auth.uid()` (you
> can't enumerate who blocked you — correct, and worth keeping). So an inline
> `select 1 from blocks where ... or (blocker_id = profiles.id and blocked_id =
> auth.uid())` can *never* match its second half: the rows proving "they
> blocked me" are invisible to me inside my own policy check. The policy still
> compiles, still passes a casual test where you block someone and confirm they
> vanish, and quietly does nothing in the direction that actually matters —
> the person who *got* blocked keeps full visibility. Every block check
> therefore goes through the `SECURITY DEFINER` helper below, which sees the
> whole table. Same reasoning for the connection check.

> **Why these two helpers live in `private`, not `public`.** They are
> `SECURITY DEFINER`, so they read past RLS by design — and PostgREST publishes
> every function in an exposed schema as `POST /rpc/<name>`, with EXECUTE
> granted to PUBLIC by default. In `public` they would be callable with
> *arbitrary* arguments by any authenticated user: `/rpc/is_blocked` answering
> "have these two people blocked each other" for any pair, and
> `/rpc/has_active_connection` enumerating the private social graph one pair at
> a time. Each function would hand out precisely the fact its own policy exists
> to withhold. Revoking EXECUTE isn't the fix — policy evaluation runs as the
> querying user and needs it. An unexposed schema is: keep `private` out of the
> API's exposed-schema list (Supabase: Settings → API → Exposed schemas).

```sql
-- Block/connection predicates used inside policies. SECURITY DEFINER so they
-- read the base tables directly instead of through the caller's RLS; STABLE so
-- Postgres can cache per-statement rather than re-running per row.
create or replace function private.is_blocked(a uuid, b uuid) returns boolean as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$ language sql stable security definer set search_path = public, pg_temp;

create or replace function private.has_active_connection(a uuid, b uuid) returns boolean as $$
  select exists (
    select 1 from connections
    where disconnected_at is null
      and ((user_a = a and user_b = b) or (user_a = b and user_b = a))
  ) and not private.is_blocked(a, b);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Directional variant, used only by connect_via_scan (§5.1) to decide whether
-- it can safely say "blocked" or has to fall back to a cover story.
create or replace function private.has_blocked(blocker uuid, target uuid) returns boolean as $$
  select exists (
    select 1 from blocks where blocker_id = blocker and blocked_id = target
  );
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function private.is_blocked(uuid, uuid) from public;
revoke all on function private.has_active_connection(uuid, uuid) from public;
revoke all on function private.has_blocked(uuid, uuid) from public;
grant execute on function private.is_blocked(uuid, uuid) to authenticated, anon;
grant execute on function private.has_active_connection(uuid, uuid) to authenticated;
-- has_blocked stays service-role/definer-only — no client role needs it.

alter table profiles enable row level security;
-- Note there is no `deleted_at is null` clause here, which is a change from the
-- obvious version — see §8. Filtering deleted profiles out at the policy level
-- also makes them unreadable to connection-history joins, which is precisely
-- what destroys the "Deleted account" placeholder that policy is built around:
-- the connection row resolves to no profile row at all. Instead, soft-delete
-- SCRUBS the row (§8) so what stays readable holds nothing private, and the
-- frontend renders the placeholder off `deleted_at is not null`. Any
-- search/discovery query must then filter `deleted_at is null` itself — that
-- filter moves to the query layer, it doesn't disappear.
create policy "profiles are publicly readable"
  on profiles for select using (not private.is_blocked(auth.uid(), id));
create policy "users can update their own profile"
  on profiles for update using (auth.uid() = id);

-- RLS decides which ROWS a user may touch and says nothing about which
-- COLUMNS. On its own, the update policy above also lets a client set its own
-- profile_version to 999999 (poisoning the notification watermark on every one
-- of its connections), clear its own deleted_at to undo an account deletion, or
-- overwrite qr_token with a chosen value. Column grants are the missing half
-- and compose with RLS:
revoke update on profiles from anon, authenticated;
grant update (name, photo_url, bio, qr_style) on profiles to authenticated;
-- qr_token rotation and account deletion go through their own SECURITY DEFINER
-- RPCs; profile_version is trigger-maintained only.

-- Profile creation is deliberately NOT a client insert — there's no insert
-- policy on profiles at all. The row is created at signup by a trigger on
-- auth.users, which also creates the contact_details row so later phone/email
-- edits are ordinary UPDATEs on an existing row.
create or replace function handle_new_user() returns trigger as $$
begin
  insert into profiles (id, name, photo_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'New user'),
    new.raw_user_meta_data->>'avatar_url'
  );
  insert into contact_details (profile_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
-- The contact_details row is created EMPTY, deliberately. Seeding it with
-- new.email would take the address someone happened to sign in with via Google
-- and make it readable by every future connection (§4 gates contact_details on
-- connection, not on consent) without ever asking. Onboarding should offer to
-- prefill it — that's a UI decision the user can decline, not a trigger's call.
-- Leaving it empty also means the row starts with nothing changed, so the
-- change-event trigger no-ops and a new profile correctly begins at version 1.

alter table contact_details enable row level security;
create policy "owner manages their own contact details"
  on contact_details for all using (profile_id = auth.uid());
create policy "connections can view contact details"
  on contact_details for select
  using (private.has_active_connection(auth.uid(), contact_details.profile_id));
-- Postgres OR's multiple permissive SELECT policies together, so a user gets
-- their own contact_details row (owner policy) plus anyone they're actively
-- connected to (connections policy) — nothing else.
-- Using the helper rather than an inline `select 1 from connections` matters
-- twice over: that subquery would be filtered by the connections SELECT
-- policy, making this policy's correctness depend on another policy's exact
-- shape, and the inline version carried no block check of its own — so a
-- blocked pair with a still-existing connection row kept reading each other's
-- phone and email for as long as the connections policy's own broken block
-- check let the row through.

alter table custom_fields enable row level security;
create policy "public custom fields readable by anyone, private only by owner"
  on custom_fields for select
  using (
    profile_id = auth.uid()
    or (is_public = true and not private.is_blocked(auth.uid(), profile_id))
  );
create policy "owner manages their own custom fields"
  on custom_fields for all using (profile_id = auth.uid());

alter table connections enable row level security;
create policy "users see their own active, unblocked connections"
  on connections for select
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and disconnected_at is null
    and not private.is_blocked(user_a, user_b)
  );
-- Inserts/updates only via the connect_via_scan / disconnect functions (§5.1, §5.6)
-- — no direct client writes to this table.

alter table blocks enable row level security;
create policy "users manage their own block list"
  on blocks for all using (blocker_id = auth.uid());

alter table reports enable row level security;
create policy "users can only see reports they filed"
  on reports for select using (reporter_id = auth.uid());
create policy "users can file reports"
  on reports for insert with check (reporter_id = auth.uid());

alter table profile_change_events enable row level security;
-- No client access at all — written by trigger, read only by the background
-- worker via the service role; no policies grant access to the authenticated
-- role. This is exactly why the three change-event trigger functions in §3
-- must be SECURITY DEFINER: RLS-with-no-policies denies the trigger's own
-- insert when the function runs as the calling user, which surfaces as every
-- profile edit failing.

alter table notifications enable row level security;
create policy "recipient reads and marks their own notifications"
  on notifications for select using (recipient_id = auth.uid());
create policy "recipient can mark their own notifications read"
  on notifications for update using (recipient_id = auth.uid());
-- No insert policy: rows come from the background worker via the service role
-- (change notifications) and from connect_via_scan, which is SECURITY DEFINER
-- and so writes past RLS (new_connection — see §5.1). Never a direct client insert.
revoke update on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;
-- Same column-scope issue as profiles: "mark their own notifications read"
-- otherwise lets a recipient rewrite type/source_profile_id/change_version on
-- any row they receive.

-- Realtime delivery (§5.2, §5.5) is not automatic — a table has to be in the
-- publication or subscriptions silently receive nothing, with no error to
-- debug. Realtime still applies each subscriber's RLS on top of this, so
-- publishing these two exposes nothing the policies above don't already allow.
alter publication supabase_realtime add table connections;
alter publication supabase_realtime add table notifications;
```

## 5. Core Flows

### 5.1 Scan → mutual connect (with concurrency + edge cases)

`connect_via_scan(scanned_token text)` should return a **structured status**, not
just succeed/fail, so the frontend responds precisely instead of a generic error
toast:

```json
{"status": "new_connection", "profile": {...}}
{"status": "already_connected", "profile": {...}}
{"status": "self_scan"}
{"status": "invalid_token"}
{"status": "blocked"}
```

`blocked` is returned **only when the caller is the one who blocked** — they
already know, so naming it is good UX and leaks nothing. When the caller is the
person who *got* blocked, return `invalid_token` instead: a distinct `blocked`
response would confirm to them that a specific person blocked them, which is
exactly the fact the `blocks` RLS policy in §4 refuses to disclose. The
directional `private.has_blocked()` helper exists for this one decision.

Handle explicitly:
- **Simultaneous scans** (A and B scan each other at the same moment): rely on
  the unique index on `connections` — the second insert conflicts; catch that
  inside the function and return `already_connected` rather than an error.
- **Self-scan**: if `scanned_token` resolves to `auth.uid()` itself, return
  `self_scan` — frontend shows "That's your own QR code," not a generic failure.
- **Invalid/expired token** (rotated or never existed): return `invalid_token` —
  frontend shows "This QR code is no longer active. Ask them for their current one."
- **Blocked**: check `blocks` (both directions) before touching `connections` at
  all — if either side has blocked the other, do not create or reactivate
  anything. Return `blocked` if `private.has_blocked(scanner, target)`,
  otherwise `invalid_token` (see above).
- **Reconnecting after a disconnect**: the unique index matches on the pair
  regardless of active/inactive state, so a second scan after a disconnect must
  REACTIVATE the existing row, not attempt a fresh insert. Look up the pair
  first: no row → insert new; row exists with `disconnected_at is null` →
  return `already_connected`; row exists with `disconnected_at is not null` →
  reactivate it (`disconnected_at = null`, `connected_at = now()`,
  `connection_epoch = connection_epoch + 1`) and reset both
  `*_notified_version` columns to the *other* person's current
  `profile_version` — a fresh reconnect shouldn't dump a flood of notifications
  about everything that changed while disconnected. The `connection_epoch` bump
  is what lets the reconnect produce a new `new_connection` notification instead
  of being swallowed as a duplicate (§3).
- **The unique-violation handler must re-read, not assume.** Catching the
  conflict from a simultaneous scan and returning `already_connected` outright is
  only correct because the pre-check established no row existed, so the
  conflicting row must be one another transaction just inserted (and therefore
  active). Keep that reasoning explicit in the code, because the moment the
  pre-check is refactored away, that same handler starts returning
  `already_connected` for a *disconnected* row and reconnection breaks with no
  error anywhere.
- **Watermarks on the NEW-connection path too, not just reconnect.** Both
  branches set `a_notified_version` = B's current `profile_version` and
  `b_notified_version` = A's — a first-time connection needs this for exactly
  the same reason a reconnect does, and it's the easier one to overlook because
  a column default silently covers for it. The `connections` columns have no
  default (§3) so this fails loudly if missed. Read both versions inside the
  same statement that creates the row, and get the a/b mapping the right way
  round: `a_notified_version` tracks how current A is on *B's* profile.
- **Soft-deleted target**: a scan resolving to a profile with `deleted_at is not
  null` returns `invalid_token`. Since the function runs `SECURITY DEFINER` it
  bypasses RLS, so it must check `deleted_at` itself — and per §8 the `profiles`
  policy no longer filters deleted rows anyway. Don't create connections to
  deleted accounts.
- **Unauthenticated scanner**: if the scanner isn't logged in, the landing page
  must preserve `scanned_token` through login/signup (e.g. as a redirect param)
  and call `connect_via_scan` automatically right after auth completes — never
  make them scan again.
- **Returning contact details:** once the connection row is inserted or
  reactivated, the `contact_details` RLS policy above already allows both sides
  to read each other's phone/email — `connect_via_scan` can just select and
  return them as part of the same response, no separate unlock step needed.
- **`connect_via_scan` writes the `new_connection` notification.** This is the
  function's job, not the background worker's — the worker is driven entirely by
  `profile_change_events`, and connecting produces no change event, so nothing
  else in the system would ever create one. Without it the scanned person's
  entire notification path (§5.2 steps 2–3 — the *only* way to reach them when
  their app is closed) has no write behind it. In the same transaction as the
  insert/reactivation:

  ```sql
  insert into notifications
    (recipient_id, source_profile_id, type, change_version, dedupe_seq)
  values (scanned_id, scanner_id, 'new_connection', null, v_connection_epoch)
  on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
  ```

  Only the scanned person gets a row. The scanner is looking at the result on
  screen and doesn't need one. Web Push for the scanned person fires off this
  insert (Realtime covers the app-open case).

**Security checklist for the function itself:**
- Always derive the scanner from `auth.uid()` — never accept a caller-supplied
  scanner ID as an argument.
- Resolve the target profile strictly from `scanned_token` — never accept an
  arbitrary profile ID directly.
- Only ever return the two profiles actually involved in this specific call.
- Don't return contact details (or report success) before the connection row
  is actually committed.
- This will likely need to run as `SECURITY DEFINER` (to bypass the
  no-direct-insert restriction on `connections`) — keep its logic tight and
  explicit about exactly these checks rather than leaning on broad elevated access.

### 5.2 Contact save — scanner vs. scanned person are different flows

Only the scanner is actively doing something in the moment — the scanned person
didn't take any action, so they need a different trigger path entirely:

**Scanner (the one who just scanned):**
1. Connection confirmed → profile appears immediately.
2. "Save to Contacts" → triggers the `.vcf` / Web Share flow → OS shows its own
   Add Contact prompt.
3. Never say "Contact saved" — the app can't confirm the OS actually completed
   the save. Say **"Contact ready to save"** / **"Open Add Contact"** instead.

**Scanned person (didn't take an action):**
1. Connection is created server-side regardless of whether they're online.
2. **If their app is open:** a Realtime event fires a "You connected with
   [name] — save their contact?" prompt right away.
3. **If their app is closed:** a Web Push notification is the only way to reach
   them; opening it lands them on the same save-contact prompt.
4. On every app open, re-sync any connections/notifications missed while
   closed — don't rely on Realtime alone to guarantee delivery.

**Escape every value that goes into the `.vcf`.** vCard is a line-based format,
so string interpolation into it is an injection sink in the same way SQL or HTML
is — and this one writes into the victim's address book. A `name` of
`Jane\r\nTEL:+15550000000` interpolated into `FN:{name}` adds an
attacker-controlled phone number to the contact every connection saves, under a
name they trust. Per RFC 6350, escape `\` → `\\`, `,` → `\,`, `;` → `\;`, and
CR/LF → `\n` in every text value — `name`, `bio`, and especially custom field
labels and values, which are free text by design. The DB-level newline checks and
length caps in §3 are the second layer, not a substitute: they cover the columns
that feed the vCard, but escaping at generation time is what actually makes the
output well-formed. Also fold long lines rather than emitting them raw.

**On requesting notification permission:** don't ask on first page load — that
reliably trains users to permanently deny it. Ask right after a user's first
successful connection, framed around the concrete benefit ("Get notified when
your connections update their info") rather than a bare browser prompt with no
context.

### 5.3 Profile & custom fields
Standard CRUD against `profiles` and `custom_fields`. Enforce the max custom
field count (e.g. 20) and the label/value length limits from the schema above.
Duplicate labels are blocked per-profile via the unique index by default.

**Save the whole profile as one operation** (one request covering every changed
field) rather than firing a save per field — the simplest fix to "editing 3
fields in a row triggers 3 separate change events."

### 5.4 Change detection & notifications — async, versioned, idempotent

Diffing, logging, AND fanning notifications out to every connection inside the
profile's `UPDATE` trigger doesn't scale — a user with 10,000 connections would
mean 10,000 notification inserts blocking their own profile save. Instead:

**What counts as a "relevant change"** (drives both the trigger `WHEN` clauses
in §3 and the notification priority below):

| Change | Bumps `profile_version`? | Notification priority |
|---|---|---|
| Name | Yes | Major |
| Phone | Yes | Major |
| Email | Yes | Major |
| Photo | Yes | Minor |
| Bio | Yes | Minor |
| QR style | No | — |
| QR token rotation | No | — |
| Custom field added / removed / value edited (public) | Yes | Minor |
| Custom field visibility toggled (either direction) | Yes | Minor |
| Custom field edited while private before *and* after | No | — |
| Custom field reorder (`sort_order` only) | No | — |

The last two rows are load-bearing, not edge cases. A private-throughout field
is invisible to connections, so notifying about it is noise plus a hint at
content they can't see; and a single drag-to-reorder rewrites `sort_order` on
every field at once, which without the filter becomes one version bump and one
change event *per row*. Both are enforced by the trigger shape in §3.

1. **Triggers stay minimal** (see the exact functions in §3). Each one diffs
   old vs. new, decides major/minor per the table above, bumps
   `profiles.profile_version`, and inserts **one** row into
   `profile_change_events` (field names only — never old/new values, so
   sensitive data isn't retained after a user changes or deletes it). No
   per-connection work happens inside any trigger.
2. **A background worker does the fan-out** (Supabase Edge Function, triggered
   by a Database Webhook on `profile_change_events` insert, or a scheduled job
   polling unprocessed rows), processing specific *events* — never re-reading
   whatever `profile_version` happens to be live at the time. That live-read is
   exactly the race to avoid: an event for version 11 must never get marked
   "notified through 12" just because version 12 landed while the worker was
   still busy with 11.
   - **Take a per-profile advisory lock first.** The webhook fires per event
     insert, so two edits in quick succession start two overlapping runs, both
     of which "pull all unprocessed events for this profile" and both of which
     fan out. Open each run with
     `select pg_try_advisory_xact_lock(hashtext(profile_id::text))` and exit
     immediately if it returns false — the other run is already covering these
     events. Without this the idempotency index still protects the notification
     rows, but the watermark writes race (see below).
   - Pull all unprocessed events for a profile, ordered by `version`, and
     treat them as one batch: `batch_is_major = true` if any event in the
     batch `is_major`; `batch_version = max(version)` in that batch.
   - Process connections in batches too (e.g. 500 at a time), **one transaction
     per batch** — not one transaction around the whole fan-out. A single
     transaction spanning every batch is the long-running lock-holding
     transaction that batching exists to avoid, so it buys nothing. Which means
     `processed_at` can't be set atomically with all of them: keep a cursor
     (last connection id handled) and mark the events processed only in the
     final batch's transaction. A crash mid-run leaves the events unprocessed and
     the next run redoes them — which is safe precisely because of the
     idempotency index and the monotonic watermark below. Don't try to solve the
     true extreme case (a single profile with 100,000 connections) now — that's a
     different notification model entirely and isn't needed at this stage.
   - **Get the a/b slot mapping right.** `user_a`/`user_b` are stored as-scanned
     and are *not* normalized (the unique index uses `least`/`greatest` precisely
     because of that), so the changed profile sits in slot A on some rows and
     slot B on others. Both the column to compare and the recipient flip with it.
     Written out, for a source profile `:src`:

     ```sql
     select id,
            case when user_a = :src then user_b else user_a end as recipient_id,
            case when user_a = :src then b_notified_version
                                   else a_notified_version end as notified_version
       from connections
      where (user_a = :src or user_b = :src)
        and disconnected_at is null
        and not private.is_blocked(user_a, user_b)
        and id > :cursor
      order by id
      limit 500;
     ```

     Note the inversion that's easy to get backwards: when the source is
     `user_a`, the relevant watermark is `b_notified_version`, because that column
     tracks how current **B** is on **A's** profile.
   - For each such connection where `batch_version > notified_version`
     (re-check `disconnected_at is null` and no block exists AT insertion time,
     not from an earlier read — a user could disconnect or block mid-run):
     - If `batch_is_major`: insert a `major_change` notification with
       `change_version = batch_version` and `dedupe_seq = batch_version`, and
       advance the watermark immediately.
     - **Advance watermarks with `greatest()`, never a blind assignment.**
       `set b_notified_version = greatest(b_notified_version, :batch_version)`.
       A plain `=` lets a slower run holding a stale batch land after a newer one
       and walk the watermark *backwards*, which re-notifies everyone about
       changes already sent. The advisory lock above makes this rare; `greatest()`
       makes it impossible, and it costs nothing.
     - If minor-only: only notify once `batch_version - *_notified_version`
       crosses the threshold (start at 3, tune later), and insert it as
       `accumulated_changes` — that's the type's whole purpose, and it's what
       lets the frontend say "Jane updated her profile" rather than implying a
       contact detail changed. Below the threshold, leave the connection's
       notified version untouched so the next batch's gap calculation stays
       accurate.
     - Insert with `on conflict (recipient_id, source_profile_id, type,
       dedupe_seq) do nothing` (§3 — an index *name* is not valid there), so
       retries and overlapping runs can't create duplicates. For change
       notifications `dedupe_seq` is the version; `new_connection` rows are
       written by `connect_via_scan`, not here (§5.1).
   - Mark every event in the batch `processed_at = now()` in the final batch's
     transaction, as described above.
3. **Tracking is per-connection, not global** — `a_notified_version` /
   `b_notified_version` live on the `connections` row, so a two-year-old
   connection and a yesterday's connection to the same profile are correctly
   tracked independently.
4. **Notification content is structured, not a frozen string** — `type`,
   `source_profile_id`, `change_version` only. The frontend generates display
   text ("Daniel updated his contact info") at render time, so wording changes
   later don't leave old notifications with stale copy baked in. Render from
   `change_version`, never from `dedupe_seq`: the two are separate columns
   because they answer different questions, and for `new_connection` the dedupe
   value is a connection epoch that means nothing to a reader (§3).

### 5.5 UI feedback: toasts & notifications

**Toasts** (ephemeral, for actions the user just took): use `sonner` (clean
API, pairs well with Next.js) or `react-hot-toast`. Fire a toast on:
- Successful connection ("You're now connected with Jane")
- Successful profile/custom field save
- QR style saved
- Contact save triggered ("Contact ready to save — check the Add Contact prompt")
- Errors — invalid/expired QR token, self-scan, blocked-by-you, failed
  scan-test on a QR style, network failure, RLS-denied action

Note there's no "you have been blocked" toast: per §5.1 that case returns
`invalid_token` and shows the expired-code copy, because a distinct message
would disclose the block to the person it was placed against.

Keep error toasts specific enough to act on ("That QR code isn't valid anymore"
beats a generic "Something went wrong"), and never surface raw Postgres/RLS
error text to the user.

**Persistent notifications** (the `notifications` table, surfaced in the UI):
- Bell icon + unread badge, counting rows where `read_at is null`.
- Realtime subscription for the app-open case, Web Push for app-closed (§5.2)
  — and always reconcile missed notifications on reopen rather than trusting
  Realtime alone for delivery.
- Render display text from the structured `type`/`source_profile_id` fields at
  render time (§5.4), not from a stored string.
- Opening a notification marks it read (`read_at = now()`) and navigates to the
  relevant connection/profile.

### 5.6 Disconnect, block, and report

Schema exists from day one (§3) even if the full UI ships later — avoids a
painful migration:
- **Disconnect** sets `connections.disconnected_at` (soft delete — keeps the
  audit trail rather than losing it). Like `connect_via_scan` this has to be a
  `SECURITY DEFINER` RPC, since clients can't write `connections` directly (§4)
  — so it carries the same obligation to verify `auth.uid()` is actually one of
  `user_a`/`user_b` on the target row rather than trusting a caller-supplied
  connection ID. Decide before building whether the other person is notified;
  the native phone contact can't be touched either way (the browser has no way
  to reach into it).
- **Block** is bidirectional and immediate: once either side blocks the other,
  the existing connection (if any) becomes invisible to both — via the RLS
  policies in §4, no schema change or deletion needed — no further
  notifications flow between them, and no new connection can be created or
  reactivated (`connect_via_scan` checks `blocks` before touching
  `connections` at all and returns a `blocked` status, per §5.1). The
  underlying connection row isn't deleted, so history is preserved if the
  block is ever reversed — it's just excluded from every read path while the
  block stands.
- **Report** is just an insert into `reports` with a category — the partial
  unique index on `(reporter_id, reported_id) where resolved_at is null` (§3)
  blocks the same person from piling reports onto the same target while a case
  is open, without permanently barring a genuine new report years later. Route
  to manual review for now, no automated action required at this stage; `notes`
  is user-supplied text, so treat it as plain text in any moderation view too.
  One caveat to be honest about: `resolved_at` is service-role-only and there's
  no moderation surface in this build, so until something actually sets it the
  partial index behaves exactly like the flat per-pair unique it replaced.
  Resolving cases by hand via the Supabase dashboard is a fine MVP answer —
  having *no* answer means the re-report path silently doesn't exist.

### 5.7 Keeping users oriented: live profile vs. saved contact

Two small additions worth building alongside the core flow, since users won't
intuitively know their phone contact isn't staying in sync with the live profile:
- On a connection's detail view, show both timestamps side by side — e.g. "QR
  Connect profile: updated today" vs. "Phone contact: last saved March 2026."
- When a major-change notification fires, offer a one-tap "Update phone
  contact" action that regenerates the vCard for that person, rather than
  making the user redo it manually from scratch.

## 6. QR Code Mechanics

- Each profile has a `qr_token` — `gen_random_uuid()` already gives a
  cryptographically random, high-entropy, effectively unguessable value, which
  satisfies the "strong bearer credential" requirement without a custom token
  scheme.
- The QR code encodes a URL like `https://app.example.com/connect/{qr_token}`.
- **Rotation, explicitly:** regenerating `qr_token` invalidates the *old* token
  for new scans, but `connections` rows reference `profiles.id`, never the
  token — so rotating your QR never breaks connections you already have. The
  token is a discovery mechanism, not an identity.
- Scanning opens the app (if installed) or a web landing page; if the scanner
  isn't authenticated, preserve the token through login (§5.1) and complete the
  connection automatically afterward.

**Customization:** users can fully style their QR code (dot style, corner
style, colors/gradients, an embedded logo/photo) via `qr-code-styling`.

Guardrails:
- **High error correction ("H" level)** whenever a logo is embedded.
- **Live scan-test** before saving a style — decode the generated canvas with a
  QR-reading library, only allow saving if it actually decodes.
- Treat the automated scan-test as a baseline, not a guarantee — a code that
  decodes perfectly on a laptop screen can still fail printed, in low light, at
  a distance, or on a cracked/glared screen. Spot-check a few real styles under
  those conditions before shipping this as a feature, not just in perfect
  lighting.
- **Keep a safe default style in reserve.** If a user's saved custom style ever
  fails validation later (e.g. after a rendering change), fall back to the
  safe default automatically rather than rendering a broken code.

## 7. Abuse Protection & Rate Limiting

A QR token is a publicly shareable credential, so scanning needs basic abuse
limits from day one:
- **Per user:** cap scans per minute and new connections per hour.
- **Per token:** cap repeated failed/invalid scan attempts against the same
  token (guards against brute-forcing rotated-out tokens).
- **Per IP/device:** watch for rapid automated scanning patterns.
- **Per reporter:** cap report submissions (e.g. 10/hour). The partial unique
  index in §3 stops one reporter piling onto one target, but says nothing about
  one account opening a report against 500 *different* people — that's the case
  a rate limit has to cover.
- **Per user, on profile mutations too** — not just scans. Each custom-field
  write bumps `profile_version` and writes a change event that fans out to every
  connection, so edit volume is notification volume. The max-20 cap (§3) bounds
  how many fields exist; nothing bounds how often they're rewritten.
- Pair this with the block/report features (§5.6) as the manual backstop for
  whatever the rate limits don't catch.

**These need a mechanism, not just a number.** "Cap scans per minute" isn't
implementable as stated — there's nowhere counting. The cheapest thing that
actually works, given every write already goes through a `SECURITY DEFINER` RPC:
a `rate_events (actor_id, action, created_at)` table with an index on
`(actor_id, action, created_at desc)`, RLS on and no client policies, checked and
appended inside those functions (`count(*) where created_at > now() -
interval '1 minute'`), pruned by the same retention job as §8. It's a table, so
the limits survive restarts and apply across serverless instances — both of which
in-memory counters in a Vercel function get wrong. Per-IP limiting has to happen
further out (Vercel middleware or a WAF) since Postgres never sees the client IP.

## 8. Data Retention & Deletion Policy

- **Account deletion:** soft-delete the profile (`deleted_at`) rather than a
  hard delete, keeping the `profiles` row so other users' connection history
  resolves to a "Deleted account" placeholder instead of a broken reference.
  Note "cascade-remove the private data" is not something the FKs do for you
  here — `on delete cascade` only fires on an actual row delete, and a soft
  delete is an UPDATE. So one `SECURITY DEFINER` RPC has to do all of it
  explicitly, in a single transaction:
  0. `set local app.suppress_change_events = 'on'` — **first statement in the
     transaction, and not optional.** Every step below looks like an ordinary
     profile edit to the triggers in §3: deleting `contact_details` fires the
     DELETE branch and logs phone+email as a *major* change, deleting each public
     custom field logs one more, and rewriting `name` trips
     `profiles_bump_version`. Without the flag, deleting your account fans out
     "they changed their phone and email" and "they changed their name" to every
     connection you ever had — and offers each of them the one-tap "Update phone
     contact" action from §5.7, which rewrites their address book entry for you to
     read `Deleted account`. `set local` scopes the flag to this transaction only.
  1. `delete from custom_fields where profile_id = me` and `delete from
     contact_details where profile_id = me` — the actual private data.
  2. Scrub the surviving row: `name = 'Deleted account'`, `photo_url = null`,
     `bio = null`, and rotate `qr_token` to a fresh value so the old printed
     code stops resolving to anything.
  3. Set `deleted_at = now()`.
  4. Leave `connections` rows intact — that's the history the placeholder
     exists to serve.
  5. Decide deliberately whether to soft-disconnect (§5.6) as well. Leaving the
     connections active means the deleted account keeps appearing in everyone's
     live contact list as a `Deleted account` placeholder, which is the intent —
     just make sure it's the intent, since it's also what keeps them countable.
- **Why the profile stays readable.** The tempting `deleted_at is null` clause
  in the `profiles` SELECT policy defeats the entire placeholder design: it
  makes the row unreadable to *everyone*, so a connection-history join returns a
  connection pointing at nothing and the client has no name to render — the
  broken reference the policy was meant to prevent. Because step 2 above leaves
  nothing private in the row, keeping it publicly readable costs nothing. The
  filtering obligation moves to the query layer instead: search, discovery, and
  `connect_via_scan` (§5.1) each exclude `deleted_at is not null` themselves.
- **Don't let Supabase's auth deletion cascade break this.** `profiles.id`
  references `auth.users(id) on delete cascade` — if the everyday "delete my
  account" flow ever calls Supabase's admin user-delete API, it will
  cascade-delete the `profiles` row too, destroying the "Deleted account"
  placeholder this whole policy depends on. The user-facing deletion flow
  should only ever soft-delete (set `profiles.deleted_at`) and must never
  touch `auth.users`. If a genuine legal/GDPR erasure request requires
  actually removing the auth record, that's a separate, deliberate pipeline —
  not the same button.
- Native phone contacts already saved by other users are entirely out of reach
  once saved — deleting an account can't and won't remove them.
- **`profile_change_events`:** prune processed rows (`processed_at` set) older
  than ~90 days.
- **`notifications`:** define a retention window (e.g. delete read
  notifications after 90–180 days; keep unread ones until read) so this table
  doesn't grow unbounded at 100k-user scale. Not urgent for an MVP launch, but
  worth having a plan before it's a production fire drill.

## 9. Operational Readiness (pre-launch hardening, not MVP-blocking)

Before pushing toward real scale — not before the first working build:
- **Capacity modeling over price-list assumptions** (see §2).
- **Cloudinary limits:** fixed image sizes, responsive transforms, WebP/AVIF, a
  max upload size — never serve full-resolution originals to every profile viewer.
- **Contact-save flow needs real-device testing before it's considered done.**
  The `.vcf`/Web Share → OS Add Contact experience varies across iOS Safari, an
  installed iOS PWA, Android Chrome, an installed Android PWA, and desktop
  browsers. Supporting the Web Share API doesn't guarantee an equivalent
  experience everywhere — test on actual devices before shipping.
- **Track, at minimum:** QR scan success/failure rate, connection-creation
  latency, contact-export success, notification delivery success, Realtime
  disconnect/failure rate, database query latency, RPC error rate — with alerts
  on connection-creation failures, latency spikes, and notification queue backlog.

## 10. Deferred / Open Items

- **Native mobile app** — the real path to a true silent native-contacts write
  (no OS prompt, no vCard step). React Native/Expo (`expo-contacts`,
  `expo-camera`) if/when the PWA's ceiling becomes a real problem.
- **Notification threshold tuning** — the "3 versions behind" minor-change
  threshold is a starting guess, not a final number.
- **`seen_version` tracking** — right now `*_notified_version` only tracks
  whether a notification was *sent*, not whether the user actually *viewed*
  the updated profile. Adding a `last_seen_version` per connection (updated
  when a user opens that connection's profile) would let the app distinguish
  "already saw this update" from "never saw it" and suppress redundant
  notifications — genuinely valuable, but a second-pass enhancement, not MVP.
- **Per-custom-field notification priority** — right now all custom field
  changes are minor, full stop (see §3). Making specific custom fields (e.g. a
  "Company" field) count as major later is a deliberate future product
  decision, not something to infer from user-typed labels.

## 11. Suggested Build Order

Get 1–4 fully working and tested before starting on 5 — that's the actual
product; the rest is infrastructure around it.

1. **Auth + profiles** — Supabase Auth with Google OAuth, `profiles` table
   (incl. `profile_version`, `deleted_at`), the `handle_new_user` signup trigger
   that creates the `profiles` + `contact_details` rows, the `private` schema
   with its policy helpers (and confirm `private` is NOT in the API's exposed
   schemas), and the column-level UPDATE grants (§4) — those go in with the
   tables, not in a later hardening pass, because retrofitting them means
   auditing whatever the client already learned to write. Then the basic profile
   view/edit screen.
2. **Custom fields** — CRUD + visibility toggle + reordering + limits (the
   max-count trigger from §3, not an app-level check; length; duplicate-label
   prevention).
3. **QR generation + scan + connect** — token generation, styling
   (`qr-code-styling` + error-correction/scan-test guardrails), the
   structured-status `connect_via_scan` function (concurrency/self-scan/
   invalid-token/blocked/reconnect handling), connections list view with
   indexes + pagination.
4. **Contact save** — the two separate scanner/scanned-person flows (§5.2),
   RFC-6350 escaping in the vCard generator (write the malicious-input test
   alongside it — a name containing CRLF must not produce a second property),
   the `new_connection` notification insert inside `connect_via_scan` (§5.1),
   Realtime for app-open (including the publication statements in §4), Web Push
   for app-closed.
5. **Async change detection + notifications** — the trigger functions on
   `profiles`/`contact_details`/`custom_fields` (§3), `profile_change_events`
   plus its two partial indexes, the batched background worker (advisory lock,
   per-batch transactions, `greatest()` watermarks, explicit a/b slot mapping —
   all §5.4), idempotent `notifications` inserts, toasts (§5.5).
6. **Disconnect / block / report** — soft-delete connections, block checks
   inside `connect_via_scan`, report insert flow.
7. **Rate limiting & abuse protection** — the `rate_events` table and RPC-side
   checks (§7), per-user/per-token/per-profile-mutation limits, per-IP at the
   edge.
8. **Polish + hardening** — profile customization UX, connection history
   search/pagination tuning, QR reset flow, retention jobs, observability
   dashboards, real-device contact-save testing, load testing against a real
   capacity model.

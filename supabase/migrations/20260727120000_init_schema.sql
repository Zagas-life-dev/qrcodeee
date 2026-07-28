-- ============================================================================
-- QR Connect — schema + tables (§3 of docs/build-spec.md)
--
-- Ordering note: this file creates ONLY the private schema, the suppression
-- helper (which references no tables), and the tables/indexes. The policy
-- helpers in `private` are SQL-language functions, whose bodies Postgres
-- parses and validates at CREATE time — so they cannot be created until
-- `blocks` and `connections` exist. They live in 20260727120200_init_rls.sql.
-- ============================================================================

-- Helper functions live here, NOT in public. PostgREST exposes every function
-- in an exposed schema as POST /rpc/<name>, and CREATE FUNCTION grants EXECUTE
-- to PUBLIC by default — so a SECURITY DEFINER predicate sitting in `public`
-- becomes a callable oracle that answers the exact question its RLS policy
-- exists to hide (§4). Keep `private` OUT of the API's exposed-schema list
-- (Supabase dashboard: Settings -> API -> Exposed schemas).
create schema if not exists private;

-- USAGE grants. Policy evaluation runs as the *querying* role, so every role
-- that can hit a policy calling into `private` needs USAGE here.
--   authenticated — the obvious one.
--   anon          — NOT in the spec, but required: `profiles` and public
--                   `custom_fields` are readable logged-out (§4, §6 landing
--                   page), and those policies call private.is_blocked(). Without
--                   USAGE an anonymous read fails with "permission denied for
--                   schema private" instead of returning rows.
--   service_role  — the change-notification worker (§5.4) filters its fan-out
--                   query with private.is_blocked() while connected as
--                   service_role.
grant usage on schema private to authenticated;
grant usage on schema private to anon;
grant usage on schema private to service_role;

-- Change-event suppression, checked by all three change-event triggers.
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


-- ---------------------------------------------------------------------------
-- profiles — one row per user, linked 1:1 to Supabase auth.users
-- ---------------------------------------------------------------------------
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
  -- User's QR customization, e.g. {"dotColor":"#1a1a2e","dotStyle":"rounded",
  -- "cornerStyle":"extra-rounded","logoUrl":"..."}. Kept separate from qr_token
  -- so rotating the token (privacy reset) doesn't wipe the chosen styling.
  qr_style jsonb not null default '{}'::jsonb
    check (pg_column_size(qr_style) <= 4096),
  -- Increments only for fields that count as a "relevant change" (§5.4 table).
  -- qr_token / qr_style changes do NOT bump it.
  profile_version int not null default 1,
  -- Soft delete (§8). The profiles SELECT policy deliberately does NOT filter
  -- on this — see the note in 20260727120200_init_rls.sql.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- contact_details — phone/email only, split out so RLS can connection-gate them
-- ---------------------------------------------------------------------------
-- Keep this table to phone/email only. Route everything else (WhatsApp,
-- LinkedIn, job title, company, ...) through custom_fields rather than adding
-- a dedicated column per platform.
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


-- ---------------------------------------------------------------------------
-- custom_fields — user-added rows, with abuse/quality limits enforced in-DB
-- ---------------------------------------------------------------------------
-- Never render `value` as raw HTML on the frontend — always plain text — and
-- escape it when generating the .vcf (§5.2), same as name/phone.
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


-- ---------------------------------------------------------------------------
-- connections — one row per mutual connection, per-direction notify tracking
-- ---------------------------------------------------------------------------
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz, -- soft delete, §5.6
  -- Incremented on every (re)activation. Exists so a disconnect -> reconnect
  -- cycle can produce a *second* new_connection notification: the idempotency
  -- index on `notifications` would otherwise treat the pair as already-notified
  -- forever and silently drop it.
  connection_epoch int not null default 1,
  -- Notification watermarks. Deliberately NO default: connect_via_scan must set
  -- each side to the OTHER person's current profile_version at connect time.
  -- `default 1` is the trap — connecting to a profile already at version 47
  -- would start you 46 versions behind, so their next trivial bio edit instantly
  -- trips the accumulated-changes threshold and fires a notification about 46
  -- changes that all happened before you ever met them. Same rule on
  -- reactivation (§5.1). Omitting the default makes forgetting this a NOT NULL
  -- violation instead of a silent bug.
  a_notified_version int not null, -- version of B's profile that A is current on
  b_notified_version int not null, -- version of A's profile that B is current on
  constraint no_self_connection check (user_a <> user_b)
);
-- Matches the pair regardless of active/inactive state — reconnecting after a
-- disconnect must REACTIVATE this row, not insert a new one (§5.1).
create unique index unique_connection_pair
  on connections (least(user_a, user_b), greatest(user_a, user_b));
create index connections_user_a_idx on connections(user_a);
create index connections_user_b_idx on connections(user_b);


-- ---------------------------------------------------------------------------
-- blocks / reports — schema from day one even though the UI ships later (§5.6)
-- ---------------------------------------------------------------------------
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
-- file again. The partial index gets both.
create unique index reports_one_open_per_pair
  on reports (reporter_id, reported_id) where resolved_at is null;
-- This constrains a single pair only. Per-reporter volume ACROSS targets (one
-- account filing 500 reports against 500 people) is not addressed here and
-- still needs the rate limit in §7.


-- ---------------------------------------------------------------------------
-- profile_change_events — written by triggers, drained by the async worker
-- ---------------------------------------------------------------------------
create table profile_change_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  version int not null,
  changed_fields text[] not null, -- field NAMES only — never old/new values
  is_major boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz -- set by the background worker once fanned out
);
-- Highest-write table in the system, with exactly two access patterns; both
-- need an index or they seq-scan all of history.
-- 1. The worker's claim query: unprocessed events for one profile, in version
--    order. Partial on `processed_at is null` so the index stays the size of the
--    live backlog (normally near-zero), not the size of the table.
create index profile_change_events_pending_idx
  on profile_change_events (profile_id, version) where processed_at is null;
-- 2. The retention job in §8, which prunes by processed_at.
create index profile_change_events_processed_idx
  on profile_change_events (processed_at) where processed_at is not null;


-- ---------------------------------------------------------------------------
-- notifications — structured, not a frozen string, with idempotency
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('major_change','accumulated_changes','new_connection')),
  -- NOT NULL on purpose: NULLs are never equal to each other in a unique index,
  -- so a nullable column in the idempotency key below would silently switch the
  -- whole guarantee off for any row that happened to have one. Cascades to match
  -- recipient_id — asymmetric FK actions here would make the deliberate
  -- hard-erasure pipeline in §8 fail on a foreign key violation.
  source_profile_id uuid not null references profiles(id) on delete cascade,
  -- DISPLAY value: which version of the source profile this was about. Null for
  -- new_connection, which isn't about a version at all. The frontend may show
  -- it; nothing keys on it.
  change_version int,
  -- DEDUPE value: the only thing the idempotency index keys on. Split from
  -- change_version because the two answer different questions:
  --   major_change / accumulated_changes -> the source's profile_version
  --   new_connection                     -> connections.connection_epoch
  -- With a single nullable change_version, every new_connection row keyed on the
  -- same coalesced sentinel, so the index permitted exactly ONE new_connection
  -- notification per (recipient, source) for the lifetime of the account — a
  -- disconnect/reconnect (§5.1) would hit `do nothing` and the scanned person
  -- would never be told.
  dedupe_seq int not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
-- One notification per (recipient, source, type, dedupe_seq) — safe against
-- worker retries and overlapping worker runs (§5.4). All four are plain NOT NULL
-- columns, so ON CONFLICT inference is unambiguous. Note ON CONFLICT cannot be
-- handed an index NAME; write the column list:
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

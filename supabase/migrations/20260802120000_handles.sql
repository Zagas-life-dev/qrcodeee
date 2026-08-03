-- ============================================================================
-- Handles + handle history (site-spec S3)
--
-- The permanent public identifier, and the thing /u/{handle} is built on.
-- Neither existing identifier can do this job: qr_token is ephemeral by design
-- (§6 — 15 minutes), and profiles.id is a uuid nobody prints on a card.
--
-- WHAT MAKES THIS MORE THAN A USERNAME COLUMN: releasing a handle has to be
-- safe. People print /u/{handle} on business cards and embed it in QR codes, so
-- a handle that becomes instantly claimable by anyone turns a stranger's
-- printed card into a destination its owner no longer controls. Every released
-- handle is therefore PARKED in handle_history, which does two jobs at once —
-- it serves the redirect, and it holds the name out of circulation while the
-- old links are still in the world.
--
-- NO citext, DELIBERATELY. The obvious spelling of this column is citext for
-- case-insensitive uniqueness, but that means an extension whose schema
-- placement differs between a local Postgres and a Supabase project, and a
-- search_path that has to agree with it everywhere. A plain `text` column whose
-- CHECK admits only lowercase gets the same guarantee for free: if the only
-- storable form is lowercase, a unique index on it IS case-insensitive. Callers
-- lowercase on the way in; there is nothing to configure.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Reserved handles
-- ---------------------------------------------------------------------------
-- A TABLE rather than an array literal inside a CHECK constraint or an
-- IMMUTABLE helper function. Two reasons, and the first is the practical one:
-- this list WILL grow — every route added to the app is a word that must stop
-- being claimable — and growing a table is an INSERT, while growing a CHECK
-- constraint is a migration that rewrites every profile row. The second is that
-- a CHECK depending on a function in another schema is a dump/restore ordering
-- hazard for no benefit.
create table reserved_handles (
  handle text primary key check (handle = lower(handle))
);

alter table reserved_handles enable row level security;
-- RLS on, ZERO policies. Nothing client-side needs to enumerate this, and the
-- two write paths that consult it are SECURITY DEFINER and see past RLS. Same
-- posture as rate_events: a readable list of what you cannot have is a small
-- gift to someone farming names.

insert into reserved_handles (handle) values
  -- Every current and planned top-level route. A handle colliding with one of
  -- these does not merely look wrong, it shadows a real page.
  ('api'), ('admin'), ('auth'), ('connect'), ('u'), ('qr'), ('scan'),
  ('login'), ('logout'), ('signup'), ('profile'), ('settings'), ('analytics'),
  ('notifications'), ('connections'), ('blocked'), ('goodbye'), ('preview'),
  ('site'), ('sites'), ('search'), ('explore'), ('new'), ('edit'),
  -- Infrastructure and well-known paths.
  ('www'), ('static'), ('assets'), ('public'), ('_next'), ('sw'),
  ('manifest'), ('favicon'), ('robots'), ('sitemap'), ('cdn'), ('mail'),
  ('smtp'), ('ftp'), ('ns'), ('mx'), ('localhost'),
  -- Anything that would let a handle impersonate the product or its staff.
  ('skan'), ('skanqr'), ('support'), ('help'), ('team'), ('staff'),
  ('official'), ('security'), ('abuse'), ('billing'), ('legal'), ('privacy'),
  ('terms'), ('about'), ('contact'), ('status'), ('blog'), ('docs'),
  ('root'), ('system'), ('null'), ('undefined'), ('me'), ('you'), ('user')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- Handle history
-- ---------------------------------------------------------------------------
create table handle_history (
  handle text primary key check (handle = lower(handle)),
  profile_id uuid not null references profiles(id) on delete cascade,
  released_at timestamptz not null default now()
);
create index handle_history_profile_idx on handle_history (profile_id);

alter table handle_history enable row level security;
-- RLS on, ZERO policies, and this one is a privacy decision rather than a
-- performance one. A `using (true)` select policy would technically serve the
-- redirect, but PostgREST would then also serve `select * from handle_history`
-- — a complete list of who used to be called what. Someone who changes their
-- handle to put distance between themselves and an old identity is exactly the
-- person that dump hurts. Lookup happens through resolve_handle() below, which
-- answers about ONE handle at a time and never enumerates.

-- How long a released handle stays parked. Defined once because three separate
-- callers below have to agree on it; if they ever disagree, a handle becomes
-- claimable by a stranger while its old URL still redirects — which is the one
-- outcome this whole table exists to prevent.
create or replace function private.handle_hold_window() returns interval as $$
  select interval '180 days';
$$ language sql immutable;


-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
alter table profiles add column handle text;

alter table profiles add constraint profiles_handle_format check (
  handle is null or (
    -- 3–30 chars, lowercase alphanumeric and underscore, must begin and end
    -- with an alphanumeric. The bounding characters are what stops '_' and
    -- '___' being handles, and what keeps a handle from ending in a character
    -- that reads as truncation when the URL is written down.
    handle ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$'
    -- Never all digits: '/u/12345' is indistinguishable from an internal id at
    -- a glance, and invites a future route that takes one.
    and handle !~ '^[0-9]+$'
  )
);


-- ---------------------------------------------------------------------------
-- Handle generation
-- ---------------------------------------------------------------------------
-- Used by handle_new_user() at signup and by the backfill below. Never returns
-- null and never returns something the CHECK above would reject — a signup that
-- fails because someone's display name was "🙂" is a signup lost to a detail
-- nobody would guess.
create or replace function private.generate_handle(src text) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  -- Fold to the alphabet the CHECK allows, then strip the underscores that
  -- leading/trailing punctuation just produced.
  base := regexp_replace(lower(coalesce(src, '')), '[^a-z0-9]+', '_', 'g');
  base := trim(both '_' from base);
  -- 20, not 30: the suffix loop needs room, and a handle at the length limit
  -- that then collides has nowhere to go.
  base := left(base, 20);
  -- left() can re-expose a trailing underscore it just cut a word in half at.
  base := trim(both '_' from base);

  -- Non-latin names, emoji-only names and all-digit names all land here. 'user'
  -- is not a good handle, but it is a VALID one, and the numeric suffix below
  -- makes it unique — which beats failing the insert.
  if base = '' or base ~ '^[0-9]+$' then
    base := 'user';
  end if;
  if length(base) < 3 then
    base := left(base || 'user', 20);
  end if;

  candidate := base;
  loop
    exit when not exists (select 1 from profiles where handle = candidate)
          and not exists (
            select 1 from handle_history
             where handle = candidate
               and released_at > now() - private.handle_hold_window()
          )
          and not exists (select 1 from reserved_handles where handle = candidate);

    n := n + 1;
    -- A popular first name can plausibly collide dozens of times; 5000 accounts
    -- called "alex" cannot be walked one integer at a time on the signup path.
    -- Past 50 tries, stop counting and take a random suffix.
    if n > 50 then
      candidate := base || '_' || encode(gen_random_bytes(3), 'hex');  -- ≤ 20+1+6
      exit;
    end if;
    candidate := base || n::text;
  end loop;

  return candidate;
end;
$$;

revoke all on function private.generate_handle(text) from public;


-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Row by row, NOT one bulk UPDATE. A set-level `update profiles set handle =
-- private.generate_handle(name)` evaluates every row against the snapshot taken
-- at statement start, so two accounts both called "Sam" would both be handed
-- "sam" and the unique index would abort the migration. Separate statements see
-- each other's writes; this is the difference between correct and "worked in
-- testing, where no two users shared a name".
do $$
declare r record;
begin
  for r in select id, name from profiles where handle is null loop
    update profiles set handle = private.generate_handle(r.name) where id = r.id;
  end loop;
end $$;

alter table profiles alter column handle set not null;
alter table profiles add constraint profiles_handle_key unique (handle);

-- NOT added to the column grants in §4. `grant update (name, photo_url, bio,
-- qr_style)` stays exactly as it is, so `handle` is unwritable by clients even
-- though the row-level update policy matches — every change goes through
-- set_handle() below, which is where the reservation, the parking and the rate
-- limit live. Adding the column here without touching the grant is the whole
-- enforcement, and it is easy to undo by accident later.


-- ---------------------------------------------------------------------------
-- Signup
-- ---------------------------------------------------------------------------
-- Replaces the §3 original. Only the handle is new; the rest is unchanged,
-- including the deliberately EMPTY contact_details row.
create or replace function handle_new_user() returns trigger as $$
declare
  display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'New user');

  insert into profiles (id, name, photo_url, handle)
  values (
    new.id,
    display_name,
    new.raw_user_meta_data->>'avatar_url',
    -- Seeded from the display name rather than the email local-part: the local
    -- part is frequently a real name plus a birth year, or an employer's
    -- convention, and it becomes a permanent public URL here.
    private.generate_handle(display_name)
  );
  insert into contact_details (profile_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


-- ---------------------------------------------------------------------------
-- resolve_handle — the public route's only read
-- ---------------------------------------------------------------------------
-- Structured status rather than a bare row, matching connect_via_scan (§5.1):
-- the caller has three genuinely different cases to render and one round trip
-- to learn which.
--
-- DELIBERATELY VIEWER-INDEPENDENT, and this is the load-bearing property. Its
-- result is cached and shared across every visitor to a handle (site-spec S12),
-- so it must not vary by who is asking — a definer function that quietly
-- applied auth.uid() would produce a cache entry shaped by whoever happened to
-- miss the cache first, and serve that to everyone else. Blocking is therefore
-- applied by the ROUTE, per viewer, outside the cached region (S9.3).
--
-- What it discloses is name, photo_url and bio, which the "profiles are
-- publicly readable" policy already serves to anon for any profile. The block
-- clause in that policy is not a boundary this removes: a blocked viewer can
-- read the same fields by signing out, which is the documented ceiling of a
-- public URL, not a regression introduced here.
create or replace function resolve_handle(p_handle text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  wanted text;
  rec record;
  moved_to text;
begin
  wanted := lower(trim(coalesce(p_handle, '')));
  if wanted = '' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select p.id, p.name, p.photo_url, p.bio, p.deleted_at
    into rec
    from profiles p
   where p.handle = wanted;

  if found then
    -- §8: a soft-deleted profile keeps its row so connection history still
    -- resolves, but it has been scrubbed and there is nothing to show. The
    -- caller renders a placeholder; it must not render an empty profile.
    if rec.deleted_at is not null then
      return jsonb_build_object('status', 'deleted');
    end if;

    return jsonb_build_object(
      'status', 'found',
      'profile', jsonb_build_object(
        'id', rec.id,
        'name', rec.name,
        'photo_url', rec.photo_url,
        'bio', rec.bio
      )
    );
  end if;

  -- Parked. Answer with the CURRENT handle so the caller can redirect, never
  -- with the profile itself — the old URL should stop being a working address
  -- for the content, or it never falls out of circulation.
  select p.handle into moved_to
    from handle_history h
    join profiles p on p.id = h.profile_id
   where h.handle = wanted
     and h.released_at > now() - private.handle_hold_window()
     and p.deleted_at is null;

  if moved_to is not null then
    return jsonb_build_object('status', 'moved', 'handle', moved_to);
  end if;

  return jsonb_build_object('status', 'not_found');
end;
$$;

revoke all on function resolve_handle(text) from public;
grant execute on function resolve_handle(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- set_handle
-- ---------------------------------------------------------------------------
-- Structured status, no bare throws — a taken handle is an ordinary outcome of
-- a form, not an exception.
create or replace function set_handle(p_handle text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  wanted text;
  current_handle text;
begin
  if uid is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  wanted := lower(trim(coalesce(p_handle, '')));

  select handle into current_handle from profiles where id = uid;
  if current_handle is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- A no-op is success. Otherwise a form that resubmits unchanged burns one of
  -- two allowed changes per 90 days on nothing.
  if wanted = current_handle then
    return jsonb_build_object('status', 'ok', 'handle', current_handle);
  end if;

  if wanted !~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$' or wanted ~ '^[0-9]+$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (select 1 from reserved_handles where handle = wanted) then
    -- Distinct from 'taken' on purpose: "that name is reserved" tells someone
    -- to pick another, where "taken" invites them to try variations forever.
    return jsonb_build_object('status', 'reserved');
  end if;

  if exists (select 1 from profiles where handle = wanted) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Parked by SOMEONE ELSE is taken; parked by the caller is theirs to reclaim,
  -- which is what makes changing your mind within the hold window recoverable
  -- rather than a permanent loss of your own name.
  if exists (
    select 1 from handle_history
     where handle = wanted
       and profile_id <> uid
       and released_at > now() - private.handle_hold_window()
  ) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Checked LAST, so a user cannot burn budget probing availability. Every
  -- rejection above is free; only a change that is actually going to happen
  -- costs one.
  if not private.rate_limit_ok(uid, 'handle_change', 2, interval '90 days') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- Park the outgoing handle before claiming the new one. on conflict covers
  -- re-releasing a handle the caller has held before: the hold window restarts
  -- from this release, not the first one.
  insert into handle_history (handle, profile_id, released_at)
  values (current_handle, uid, now())
  on conflict (handle) do update
    set profile_id = excluded.profile_id,
        released_at = excluded.released_at;

  -- Reclaiming one of the caller's own parked handles: drop the parking row, or
  -- the unique index on profiles.handle and this table would both claim it.
  delete from handle_history where handle = wanted and profile_id = uid;

  update profiles set handle = wanted where id = uid;

  return jsonb_build_object('status', 'ok', 'handle', wanted);
end;
$$;

revoke all on function set_handle(text) from public;
grant execute on function set_handle(text) to authenticated;

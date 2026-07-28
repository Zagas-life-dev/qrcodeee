-- ============================================================================
-- §7 abuse protection.
--
-- "These need a mechanism, not just a number. 'Cap scans per minute' isn't
-- implementable as stated — there's nowhere counting."
--
-- A table, not an in-memory counter: limits have to survive restarts and apply
-- across serverless instances, and a Map in a Vercel function gets both wrong.
-- Every write in this product already goes through a SECURITY DEFINER RPC or a
-- trigger, so those are the natural chokepoints.
-- ============================================================================

create table rate_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references profiles(id) on delete cascade,
  action text not null,
  -- The thing being acted ON, when a limit is keyed to the target rather than
  -- the actor — currently only failed scans against one token. Nullable because
  -- most limits are purely per-actor.
  subject text,
  created_at timestamptz not null default now()
);

-- The per-actor lookup: "how many of this action in the last N".
create index rate_events_actor_idx on rate_events (actor_id, action, created_at desc);
-- The per-subject lookup, partial so it stays the size of the subject-keyed
-- subset rather than the whole table.
create index rate_events_subject_idx on rate_events (action, subject, created_at desc)
  where subject is not null;
-- The retention prune (§8) — this table is pure exhaust and must not grow
-- unbounded.
create index rate_events_created_idx on rate_events (created_at);

alter table rate_events enable row level security;
-- No policies at all. Clients neither read nor write this; every access is via
-- the SECURITY DEFINER helper below or the service role. Letting a client read
-- its own rows would also hand it a precise "how close am I to the limit"
-- oracle, which is exactly what an abuser wants.


-- ---------------------------------------------------------------------------
-- The check-and-record primitive
-- ---------------------------------------------------------------------------
-- Returns true if the action is allowed, and records it. Returns false without
-- recording — a sliding window, so someone who trips a limit recovers once the
-- window passes rather than extending their own lockout by retrying. That's the
-- kinder failure mode for a legitimate user who hit a cap, and the abuse case is
-- already bounded by the cap itself.
create or replace function private.rate_limit_ok(
  p_actor uuid,
  p_action text,
  p_limit int,
  p_window interval,
  p_subject text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  -- No session means this isn't a user action: the signup trigger, the
  -- notification worker, retention jobs. Rate limiting those would break them.
  if p_actor is null then return true; end if;

  -- Account deletion (§8) deletes every custom field and the contact_details row
  -- in one transaction. Under a per-user mutation cap that is indistinguishable
  -- from abuse, and a user could be locked out of deleting their own account.
  -- The same flag that suppresses change events marks the operation internal.
  if private.change_events_suppressed() then return true; end if;

  if p_subject is null then
    select count(*) into n
      from rate_events
     where actor_id = p_actor
       and action = p_action
       and created_at > now() - p_window;
  else
    -- Subject-keyed limits count across ALL actors, which is the point: one
    -- token being hammered from many accounts is the pattern worth catching.
    select count(*) into n
      from rate_events
     where action = p_action
       and subject = p_subject
       and created_at > now() - p_window;
  end if;

  if n >= p_limit then return false; end if;

  insert into rate_events (actor_id, action, subject)
  values (p_actor, p_action, p_subject);
  return true;
end;
$$;

revoke all on function private.rate_limit_ok(uuid, text, int, interval, text) from public;
-- Definer-only. No client role needs it, and exposing it would let a caller both
-- probe and BURN another user's budget by calling it with their id.


-- ---------------------------------------------------------------------------
-- Profile mutation limits (§7: "edit volume is notification volume")
-- ---------------------------------------------------------------------------
-- The max-20 cap bounds how many custom fields EXIST; nothing bounded how often
-- they are rewritten. Every rewrite bumps profile_version and writes a change
-- event that fans out to every connection, so an unlimited edit loop is a
-- notification amplifier pointed at other people's phones.
create or replace function enforce_profile_mutation_rate() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.rate_limit_ok(auth.uid(), 'profile_mutation', 60, interval '1 hour') then
    raise exception 'profile mutation rate limit exceeded'
      using errcode = '53400';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- The WHEN clauses below MIRROR the change-event triggers on purpose, and the
-- omission of sort_order is load-bearing in exactly the same way: a single
-- drag-to-reorder rewrites sort_order on up to 20 rows, and an unfiltered row
-- trigger would spend 20 of the user's 60 hourly mutations on one gesture. Three
-- drags and they are locked out of their own profile.
create trigger custom_fields_rate_limit
  before insert or delete on custom_fields
  for each row execute function enforce_profile_mutation_rate();

create trigger custom_fields_rate_limit_update
  before update on custom_fields
  for each row
  when (new.label is distinct from old.label
     or new.value is distinct from old.value
     or new.is_public is distinct from old.is_public)
  execute function enforce_profile_mutation_rate();

create trigger profiles_rate_limit
  before update on profiles
  for each row
  when (new.name is distinct from old.name
     or new.photo_url is distinct from old.photo_url
     or new.bio is distinct from old.bio)
  execute function enforce_profile_mutation_rate();

create trigger contact_details_rate_limit
  before update on contact_details
  for each row
  when (new.phone is distinct from old.phone
     or new.email is distinct from old.email)
  execute function enforce_profile_mutation_rate();


-- ---------------------------------------------------------------------------
-- Report volume (§7: 10/hour)
-- ---------------------------------------------------------------------------
-- The partial unique index in §3 stops one reporter piling onto one target. It
-- says nothing about one account opening a report against 500 DIFFERENT people,
-- which is the case this covers.
create or replace function enforce_report_rate() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.rate_limit_ok(auth.uid(), 'report', 10, interval '1 hour') then
    raise exception 'report rate limit exceeded'
      using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger reports_rate_limit
  before insert on reports
  for each row execute function enforce_report_rate();


revoke all on function public.enforce_profile_mutation_rate() from public, anon, authenticated;
revoke all on function public.enforce_report_rate() from public, anon, authenticated;

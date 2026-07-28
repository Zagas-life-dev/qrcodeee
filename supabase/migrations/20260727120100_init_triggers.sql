-- ============================================================================
-- QR Connect — trigger functions + triggers (§3 of docs/build-spec.md)
--
-- Every change-event function below is SECURITY DEFINER. That is REQUIRED, not
-- hardening: profile_change_events has RLS enabled with no policies at all
-- (§4), and a plain trigger function runs with the CALLING user's privileges —
-- so the insert would be rejected and *every profile update would fail*.
-- Created in a migration so they are owned by `postgres` (which bypasses RLS),
-- with search_path pinned so a schema on the caller's path can't hijack name
-- resolution.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance, enforced at the DB level
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger contact_details_set_updated_at
  before update on contact_details
  for each row execute function set_updated_at();

create trigger custom_fields_set_updated_at
  before update on custom_fields
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- profiles: version bump + change event
-- ---------------------------------------------------------------------------
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
-- (the version did change). That is safe but only by construction — the function
-- finds no name/photo_url/bio diff and bails before inserting, so there's no
-- duplicate event. Don't relax that early return, and don't widen the WHEN
-- clause above to fire on any update, or those cross-table bumps start
-- double-logging.


-- ---------------------------------------------------------------------------
-- contact_details: change event (phone/email are always MAJOR)
-- ---------------------------------------------------------------------------
-- contact_details lives on a separate table from profiles, so it can't use the
-- "bump NEW in a BEFORE trigger" trick — it atomically increments
-- profiles.profile_version itself via UPDATE ... RETURNING, which is safe under
-- concurrent writes.
--
-- Fires on INSERT and DELETE too, not just UPDATE. An UPDATE-only trigger misses
-- the most common real case there is: a user who signs up without a phone
-- number, connects with people, and *then* adds one. That's the single most
-- notification-worthy change in the product, and UPDATE-only silently drops it.
-- (handle_new_user creates the row at signup, so most edits will in fact be
-- UPDATEs — but don't depend on that being the only path.)
--
-- Note the TG_OP branching rather than coalesce(new.phone, old.phone)-style
-- shorthand: in PL/pgSQL, OLD is not a usable record in an INSERT trigger (nor
-- NEW in a DELETE trigger), so reaching for the wrong one is an error, not a null.
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


-- ---------------------------------------------------------------------------
-- custom_fields: max-count limit + change event
-- ---------------------------------------------------------------------------
-- The max-field-count limit has to live HERE, not "in application logic". The
-- client talks to Postgres directly under the `for all using (profile_id =
-- auth.uid())` policy in §4, so any app-level cap is advisory — a scripted
-- client can insert unboundedly. That isn't just a data-quality problem: every
-- insert bumps profile_version and writes a change event, and every event fans
-- out to all of that user's connections, so an unenforced cap is a notification
-- amplification vector.
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

-- Custom field changes are always treated as minor — deliberately NOT
-- prioritized by the user-created label (arbitrary text like "Company" vs.
-- "company" vs. "Company Name" isn't reliable input to hang notification logic
-- on). See §10 if per-field priority is ever wanted.
--
-- Two things this must NOT do:
--   * bump the version on a pure reorder. Dragging fields around rewrites
--     sort_order on up to 20 rows, and an unfiltered row trigger turns that one
--     gesture into 20 version bumps and 20 change events.
--   * bump the version for a field that is private both before AND after the
--     change. Connections can't see it (§4), so notifying them amounts to "they
--     changed something you're not allowed to see" — noise plus a small leak. A
--     visibility flip in either direction DOES count: the field genuinely
--     appears or disappears for them.
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

-- UPDATE: only label/value/visibility count — sort_order is deliberately absent,
-- which is what makes reordering free. This can't be folded into the trigger
-- above: Postgres rejects a WHEN clause referencing OLD on an INSERT trigger, so
-- the two cases need separate CREATE TRIGGER statements.
create trigger custom_fields_log_update_event
  after update on custom_fields
  for each row
  when (new.label is distinct from old.label
     or new.value is distinct from old.value
     or new.is_public is distinct from old.is_public)
  execute function log_custom_field_change_event();


-- ---------------------------------------------------------------------------
-- signup: create the profiles + contact_details rows
-- ---------------------------------------------------------------------------
-- Profile creation is deliberately NOT a client insert — there is no insert
-- policy on profiles at all (§4). The row is created here, along with the
-- contact_details row so later phone/email edits are ordinary UPDATEs.
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
-- prefill it — a UI decision the user can decline, not a trigger's call.
-- Leaving it empty also means the row starts with nothing changed, so the
-- change-event trigger no-ops and a new profile correctly begins at version 1.

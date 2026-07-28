-- ============================================================================
-- Fix: hard-deleting a profile fails with a NOT NULL violation.
--
--     ERROR: null value in column "version" of relation "profile_change_events"
--            violates not-null constraint
--     CONTEXT: PL/pgSQL function log_custom_field_change_event()
--
-- The sequence, all inside one cascade:
--   delete auth.users  -> cascade deletes profiles
--                      -> cascade deletes custom_fields / contact_details
--                      -> their AFTER DELETE triggers fire
--                      -> `update profiles ... returning profile_version` matches
--                         NO ROW, because that profile is already gone
--                      -> new_version is NULL
--                      -> insert into profile_change_events (version NOT NULL) fails
--
-- Why this matters even though §8 says never hard-delete: §8 also says a genuine
-- legal/GDPR erasure request is "a separate, deliberate pipeline" that removes
-- the auth record — and that pipeline could not complete. The FK comment on
-- notifications.source_profile_id makes the same point, that the hard-erasure
-- path is expected to work.
--
-- The fix is to treat "the profile row is gone" as what it plainly is: there is
-- no version to record and nobody left to notify. Bail out instead of inserting
-- a half-formed event.
--
-- log_profile_change_event needs no change — it is an AFTER UPDATE on `profiles`
-- itself and reads new.profile_version, so its row is guaranteed to exist.
-- ============================================================================

create or replace function log_contact_details_change_event() returns trigger as $$
declare
  changed text[] := array[]::text[];
  new_version int;
  pid uuid;
begin
  if private.change_events_suppressed() then return null; end if;
  if tg_op = 'INSERT' then
    pid := new.profile_id;
    if new.phone is not null then changed := array_append(changed, 'phone'); end if;
    if new.email is not null then changed := array_append(changed, 'email'); end if;
  elsif tg_op = 'DELETE' then
    pid := old.profile_id;
    if old.phone is not null then changed := array_append(changed, 'phone'); end if;
    if old.email is not null then changed := array_append(changed, 'email'); end if;
  else
    pid := new.profile_id;
    if new.phone is distinct from old.phone then changed := array_append(changed, 'phone'); end if;
    if new.email is distinct from old.email then changed := array_append(changed, 'email'); end if;
  end if;
  if array_length(changed, 1) is null then return null; end if;

  update profiles set profile_version = profile_version + 1
    where id = pid
    returning profile_version into new_version;

  -- Profile already gone (cascade delete in progress): nothing to version and
  -- nobody to notify.
  if new_version is null then return null; end if;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (pid, new_version, changed, true);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


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

  -- Profile already gone (cascade delete in progress): nothing to version and
  -- nobody to notify.
  if new_version is null then return null; end if;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (pid, new_version, array['custom_field'], false);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

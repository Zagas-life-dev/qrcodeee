-- ============================================================================
-- Fix: `changed := changed || 'name'` fails at runtime.
--
-- `changed` is text[] and 'name' is an untyped literal, so Postgres has three
-- candidate operators to choose from — anyarray||anyarray, anyarray||anyelement,
-- anyelement||anyarray — and resolves the unknown literal to the array form. It
-- then tries to parse 'name' as an array literal and raises:
--
--     ERROR: malformed array literal: "name"
--     DETAIL: Array value must start with "{" or dimension information.
--
-- This is not cosmetic. It fires inside the AFTER UPDATE trigger, so the whole
-- statement aborts: EVERY name/photo/bio edit and EVERY phone/email edit failed
-- with a type error that names neither the trigger nor the real cause. Caught by
-- scripts/verify-rls.mjs — it does not reproduce in a structural check, because
-- the function definition is perfectly valid until a row actually flows through it.
--
-- array_append(anyarray, anyelement) has exactly one candidate, so the literal
-- resolves to text and there is nothing to guess. An explicit ::text cast on
-- every literal would work equally well; this is just harder to get wrong later.
--
-- log_custom_field_change_event is untouched — it builds array['custom_field']
-- directly and was never ambiguous.
-- ============================================================================

create or replace function log_profile_change_event() returns trigger as $$
declare
  changed text[] := array[]::text[];
  major boolean := false;
begin
  if private.change_events_suppressed() then return null; end if;
  if new.name is distinct from old.name then
    changed := array_append(changed, 'name'); major := true;
  end if;
  if new.photo_url is distinct from old.photo_url then
    changed := array_append(changed, 'photo_url');
  end if;
  if new.bio is distinct from old.bio then
    changed := array_append(changed, 'bio');
  end if;
  if array_length(changed, 1) is null then return null; end if;

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (new.id, new.profile_version, changed, major);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;


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

  insert into profile_change_events (profile_id, version, changed_fields, is_major)
  values (pid, new_version, changed, true);
  return null; -- AFTER trigger: return value is ignored
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

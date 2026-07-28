-- ============================================================================
-- Fix: restore app.suppress_change_events to delete_my_account().
--
-- 20260728000000 rewrote this function to delete qr_tokens rows in place of the
-- qr_token column it dropped, and in doing so lost the FIRST statement of the
-- original body:
--
--     perform set_config('app.suppress_change_events', 'on', true);
--
-- 20260727210000 labelled that line "STEP 0, AND IT MUST BE FIRST" and spelled
-- out why. Every deletion below is indistinguishable, to the §3 triggers, from
-- an ordinary edit:
--
--   delete from contact_details  -> DELETE branch logs phone+email as MAJOR
--   delete from custom_fields    -> one change event per public field
--   update profiles set name     -> trips profiles_bump_version
--
-- So deleting your account announced "they changed their phone and email" and
-- "they changed their name" to every connection you ever had — each carrying
-- §5.7's one-tap "Update phone contact" action, which rewrites the saved address
-- book entry to read "Deleted account". The person leaving quietly instead
-- pushed a corrupted contact card to everyone who ever saved them.
--
-- It also exempts the transaction from the §7 mutation rate limit. Without it a
-- user with a full set of custom fields can trip the limit part-way through and
-- be locked out of deleting their own account, having already had their contact
-- details destroyed.
--
-- verify-deletion.mjs caught both:
--   FAIL  deletion produced ZERO change events   (3 events written)
--   FAIL  the bulk delete did not burn rate-limit budget either
--
-- set_config(..., true) is transaction-local. Because this function carries a
-- SET clause, Postgres pushes a GUC nest level on entry and unwinds it on exit,
-- so the flag cannot outlive the call even if the caller reuses the session.
-- ============================================================================

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- STEP 0, AND IT MUST BE FIRST. See the header before moving or removing it.
  perform set_config('app.suppress_change_events', 'on', true);

  delete from contact_details where profile_id = me;
  delete from custom_fields where profile_id = me;
  delete from push_subscriptions where profile_id = me;
  delete from notifications where recipient_id = me;
  delete from blocks where blocker_id = me;

  -- §6: kill outstanding ephemeral codes, which replaced the qr_token rotation
  -- the original version of this function performed.
  delete from qr_tokens where profile_id = me;

  -- Deliberately NOT deleted: rows in `reports` this user filed. Those are
  -- moderation records about OTHER people's behaviour, and destroying them would
  -- let someone erase evidence by closing their account.

  update profiles
     set name = 'Deleted account',
         photo_url = null,
         bio = null,
         deleted_at = now()
   where id = me
     and deleted_at is null;

  -- connections are left untouched on purpose — see 20260727210000.
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;

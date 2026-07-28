-- ============================================================================
-- §8 account deletion.
--
-- Soft delete, never a hard one. The profiles row survives so that other
-- people's connection history resolves to a "Deleted account" placeholder
-- instead of a broken reference — which is also why the profiles SELECT policy
-- deliberately does NOT filter on deleted_at (§4).
--
-- `on delete cascade` does none of this for you: it only fires on an actual row
-- DELETE, and this is an UPDATE. So every step is explicit, in one transaction.
--
-- DECISION §8 STEP 5 LEAVES OPEN — connections are left ACTIVE.
-- The placeholder is the entire point of this design: §8 builds the "why the
-- profile stays readable" argument around connection history resolving to
-- something. Soft-disconnecting would make the row vanish from everyone's list
-- and throw away the history the placeholder exists to serve. The cost is that a
-- deleted account lingers in other people's lists — which is why the per-
-- connection Disconnect action is offered for deleted accounts too (§5.6), so
-- anyone who wants it gone can remove it themselves.
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

  -- STEP 0, AND IT MUST BE FIRST. Every step below is indistinguishable from an
  -- ordinary edit to the triggers in §3: deleting contact_details fires the
  -- DELETE branch and logs phone+email as a MAJOR change, deleting each public
  -- custom field logs one more, and rewriting name trips profiles_bump_version.
  --
  -- Without this flag, deleting your account fans out "they changed their phone
  -- and email" and "they changed their name" to every connection you ever had —
  -- and offers each of them the one-tap "Update phone contact" action from §5.7,
  -- which rewrites their address book entry for you to read "Deleted account".
  --
  -- It also exempts this transaction from the §7 mutation rate limit, which
  -- would otherwise see a bulk delete of up to 20 custom fields as abuse and
  -- could lock someone out of deleting their own account.
  --
  -- set_config(..., true) is transaction-local. Because this function carries a
  -- SET clause, Postgres pushes a GUC nest level on entry and unwinds it on
  -- exit, so the flag cannot outlive the call even if the caller reuses the
  -- session.
  perform set_config('app.suppress_change_events', 'on', true);

  -- 1. The actual private data.
  delete from custom_fields where profile_id = me;
  delete from contact_details where profile_id = me;

  -- Not in §8's list, but they are this user's data and pure liability once the
  -- account is gone: device push endpoints, their own notification inbox, and
  -- the block list of an account nobody can scan any more.
  delete from push_subscriptions where profile_id = me;
  delete from notifications where recipient_id = me;
  delete from blocks where blocker_id = me;

  -- Deliberately NOT deleted: rows in `reports` this user filed. Those are
  -- moderation records about OTHER people's behaviour, and destroying them would
  -- let someone erase evidence by closing their account. Their contact details
  -- are gone either way, so the residual disclosure is a user id.

  -- 2. Scrub the surviving row so what stays publicly readable holds nothing
  --    private, and 3. mark it deleted. Rotating qr_token stops any printed code
  --    resolving to this account.
  update profiles
     set name = 'Deleted account',
         photo_url = null,
         bio = null,
         qr_token = gen_random_uuid()::text,
         deleted_at = now()
   where id = me
     and deleted_at is null;

  -- 4. connections are left untouched on purpose — see the header.
end;
$$;

revoke all on function delete_my_account() from public;
revoke all on function delete_my_account() from anon;
grant execute on function delete_my_account() to authenticated;

-- NOTE FOR ANY FUTURE GDPR ERASURE PIPELINE (§8): actually removing the
-- auth.users row cascades to profiles and destroys the placeholder this whole
-- design depends on. That is a separate, deliberate pipeline — never this
-- button. The cascade itself does now work correctly (see
-- 20260727120400_fix_change_events_on_profile_delete.sql), so it is a policy
-- decision rather than a technical blocker.

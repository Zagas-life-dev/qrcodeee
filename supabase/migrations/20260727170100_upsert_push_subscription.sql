-- ============================================================================
-- Register a Web Push subscription for the calling user.
--
-- Why this can't be a plain client upsert: `endpoint` is globally unique because
-- it identifies one browser install, and the owner policy on push_subscriptions
-- is `for all using (profile_id = auth.uid())`. So when a device that was
-- previously registered to account A signs in as account B — a shared phone, or
-- simply signing out and back in — B's upsert has to overwrite a row it cannot
-- see or touch under RLS. It fails with a unique violation, and the practical
-- result is that account A keeps receiving that device's notifications
-- indefinitely while B silently gets none.
--
-- DEFINER, with the delete and insert in one transaction, so the endpoint MOVES.
-- The elevated access is used for exactly one thing: removing a row keyed on an
-- endpoint the caller has demonstrably just been handed by the push service.
-- ============================================================================

create or replace function upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from push_subscriptions where endpoint = p_endpoint;

  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 512));
end;
$$;

revoke all on function upsert_push_subscription(text, text, text, text) from public;
revoke all on function upsert_push_subscription(text, text, text, text) from anon;
grant execute on function upsert_push_subscription(text, text, text, text) to authenticated;

-- Unsubscribing needs no RPC: the owner policy already permits
-- `delete from push_subscriptions where endpoint = ...` for your own rows.

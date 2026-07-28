-- ============================================================================
-- §8 data retention, plus the §7 rate_events prune ("pruned by the same
-- retention job as §8").
--
-- Every delete is BATCHED. An unbounded `delete from ... where created_at < ...`
-- on the highest-write table in the system is a long-running transaction holding
-- locks over an arbitrary number of rows — exactly the shape §5.4 batches the
-- notification fan-out to avoid. Repeated runs drain a backlog; one run never
-- blocks the app.
-- ============================================================================

create or replace function run_retention(p_batch int default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_events int;
  v_notifications int;
  v_rate int;
begin
  -- §8: prune PROCESSED change events older than ~90 days. Unprocessed rows are
  -- never touched regardless of age — they are the worker's backlog, and
  -- deleting one silently drops a notification nobody will ever get.
  -- Uses profile_change_events_processed_idx.
  with doomed as (
    select id from profile_change_events
     where processed_at is not null
       and processed_at < now() - interval '90 days'
     limit p_batch
  )
  delete from profile_change_events e using doomed d where e.id = d.id;
  get diagnostics v_events = row_count;

  -- §8: delete READ notifications after 180 days. Unread ones are kept until
  -- read, per the spec.
  --
  -- Worth flagging: that rule is unbounded. A user who never opens the app
  -- accumulates unread rows forever, and at 100k MAU this is the table most
  -- likely to become a surprise. The spec is explicit, so this follows it — but
  -- a "delete unread after N years" rule is the obvious next lever if this table
  -- starts growing faster than the user base.
  with doomed as (
    select id from notifications
     where read_at is not null
       and read_at < now() - interval '180 days'
     limit p_batch
  )
  delete from notifications n using doomed d where n.id = d.id;
  get diagnostics v_notifications = row_count;

  -- §7: the longest rate window is one hour, so anything older than a day is
  -- pure exhaust. This table sees a write on every scan and every profile edit,
  -- making it the fastest-growing one here.
  with doomed as (
    select id from rate_events
     where created_at < now() - interval '1 day'
     limit p_batch
  )
  delete from rate_events r using doomed d where r.id = d.id;
  get diagnostics v_rate = row_count;

  return jsonb_build_object(
    'change_events', v_events,
    'notifications', v_notifications,
    'rate_events', v_rate,
    -- Tells the caller whether a backlog remains, so a run can be repeated
    -- rather than waiting a full day to remove the next batch.
    'more', (v_events = p_batch or v_notifications = p_batch or v_rate = p_batch)
  );
end;
$$;

revoke all on function run_retention(int) from public;
revoke all on function run_retention(int) from anon, authenticated;
grant execute on function run_retention(int) to service_role;

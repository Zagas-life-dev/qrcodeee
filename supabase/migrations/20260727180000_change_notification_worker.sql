-- ============================================================================
-- §5.4 background fan-out worker.
--
-- Why this lives in SQL rather than in the Edge/serverless function that drives
-- it: §5.4 requires a per-profile advisory lock and ONE TRANSACTION PER BATCH.
-- PostgREST gives one transaction per request and no way to hold a lock across
-- statements, so a JavaScript implementation could honour neither. Here, each
-- call to process_change_batch IS one transaction, which makes the lock and the
-- batch boundary the same thing.
--
-- These functions live in `public` (not `private`) because the driver reaches
-- them over PostgREST as service_role, and `private` is deliberately kept out of
-- the exposed schema list (§4). They are revoked from anon and authenticated —
-- service_role only.
-- ============================================================================

-- Which profiles have work waiting. Uses the partial index on
-- (profile_id, version) where processed_at is null, so this stays proportional
-- to the live backlog rather than to all of history.
create or replace function pending_change_profiles(p_limit int default 50)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct profile_id
    from profile_change_events
   where processed_at is null
   limit p_limit;
$$;


-- Processes ONE batch of connections for one profile, in one transaction.
--
-- The caller loops while `done` is false, passing back `cursor` and
-- `batch_version` each time.
create or replace function process_change_batch(
  p_profile_id uuid,
  p_cursor uuid default null,
  p_batch_version int default null,
  p_limit int default 500,
  p_minor_threshold int default 3
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_version int;
  v_is_major boolean;
  v_event_count int;
  v_handled int := 0;
  v_notified int := 0;
  v_next_cursor uuid;
  r record;
begin
  -- The webhook fires per event insert, so two edits in quick succession start
  -- two overlapping runs — both of which would pull the same unprocessed events
  -- and both of which would fan out. Bail rather than queue: the run that holds
  -- the lock is already covering these events.
  if not pg_try_advisory_xact_lock(hashtext(p_profile_id::text)) then
    return jsonb_build_object('locked', false, 'done', false);
  end if;

  -- Summary over EVENTS, never over live state. Re-reading
  -- profiles.profile_version here is the exact race §5.4 warns about: an event
  -- for version 11 must not get marked "notified through 12" just because
  -- version 12 landed while this run was busy.
  select coalesce(max(version), 0), coalesce(bool_or(is_major), false), count(*)
    into v_batch_version, v_is_major, v_event_count
    from profile_change_events
   where profile_id = p_profile_id
     and processed_at is null
     -- On continuation calls, stay pinned to the version the FIRST batch saw.
     -- Without this, events arriving mid-run would raise batch_version for later
     -- batches only, so connections handled in batch 1 would be marked notified
     -- through v11 while the events through v12 got marked processed — and those
     -- people would never hear about v12.
     and (p_batch_version is null or version <= p_batch_version);

  if p_batch_version is not null then
    v_batch_version := p_batch_version;
  end if;

  if v_event_count = 0 then
    return jsonb_build_object('locked', true, 'done', true, 'notified', 0, 'events', 0);
  end if;

  for r in
    -- The a/b mapping is the easy thing to get backwards. user_a/user_b are
    -- stored as-scanned and deliberately NOT normalised (the unique index uses
    -- least/greatest precisely because of that), so the changed profile sits in
    -- slot A on some rows and slot B on others. When the source is user_a, the
    -- relevant watermark is b_notified_version — because that column tracks how
    -- current B is on A's profile.
    select id,
           case when user_a = p_profile_id then user_b else user_a end as recipient_id,
           case when user_a = p_profile_id then b_notified_version
                                           else a_notified_version end as notified_version,
           (user_a = p_profile_id) as source_is_a
      from connections
     where (user_a = p_profile_id or user_b = p_profile_id)
       and disconnected_at is null
       -- Re-checked here, at insertion time, rather than carried from an earlier
       -- read: someone can disconnect or block mid-run.
       and not private.is_blocked(user_a, user_b)
       and (p_cursor is null or id > p_cursor)
     order by id
     limit p_limit
  loop
    v_next_cursor := r.id;
    v_handled := v_handled + 1;

    if v_batch_version > r.notified_version then
      if v_is_major then
        insert into notifications
          (recipient_id, source_profile_id, type, change_version, dedupe_seq)
        values (r.recipient_id, p_profile_id, 'major_change', v_batch_version, v_batch_version)
        on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
        v_notified := v_notified + 1;

      elsif v_batch_version - r.notified_version >= p_minor_threshold then
        -- Minor changes accumulate. This type exists so the frontend can say
        -- "Jane updated her profile" without implying a contact detail changed.
        insert into notifications
          (recipient_id, source_profile_id, type, change_version, dedupe_seq)
        values (r.recipient_id, p_profile_id, 'accumulated_changes', v_batch_version, v_batch_version)
        on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
        v_notified := v_notified + 1;

      else
        -- Minor and below threshold: leave the watermark ALONE so the gap keeps
        -- accumulating and the next batch's arithmetic stays accurate. Advancing
        -- it here would reset the count and the user would never reach the
        -- threshold on a slow drip of small edits.
        continue;
      end if;

      -- greatest(), never a blind assignment. A slower run holding a stale batch
      -- could otherwise land after a newer one and walk the watermark BACKWARDS,
      -- re-notifying everyone about changes already sent. The advisory lock makes
      -- that rare; this makes it impossible, and costs nothing.
      if r.source_is_a then
        update connections
           set b_notified_version = greatest(b_notified_version, v_batch_version)
         where id = r.id;
      else
        update connections
           set a_notified_version = greatest(a_notified_version, v_batch_version)
         where id = r.id;
      end if;
    end if;
  end loop;

  -- A short page means we reached the end. Mark the events processed only now,
  -- in this final batch's transaction. A crash mid-run leaves them unprocessed
  -- and the next run redoes the whole fan-out — which is safe precisely because
  -- of the idempotency index and the monotonic watermark above.
  if v_handled < p_limit then
    update profile_change_events
       set processed_at = now()
     where profile_id = p_profile_id
       and processed_at is null
       and version <= v_batch_version;

    return jsonb_build_object(
      'locked', true, 'done', true,
      'notified', v_notified, 'connections', v_handled,
      'events', v_event_count, 'version', v_batch_version
    );
  end if;

  return jsonb_build_object(
    'locked', true, 'done', false,
    'cursor', v_next_cursor, 'batch_version', v_batch_version,
    'notified', v_notified, 'connections', v_handled
  );
end;
$$;

revoke all on function pending_change_profiles(int) from public;
revoke all on function pending_change_profiles(int) from anon, authenticated;
grant execute on function pending_change_profiles(int) to service_role;

revoke all on function process_change_batch(uuid, uuid, int, int, int) from public;
revoke all on function process_change_batch(uuid, uuid, int, int, int) from anon, authenticated;
grant execute on function process_change_batch(uuid, uuid, int, int, int) to service_role;

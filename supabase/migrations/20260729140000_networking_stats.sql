-- ============================================================================
-- Networking analytics (§9 "track scan success rate ... connection-creation").
--
-- PRESERVING THE SCAN RECORD. mint_qr_token swept every expired token an hour
-- after death, which threw away qr_tokens.scan_count — the only record in the
-- system that anyone's code was ever scanned. Analytics need that history, and
-- keeping ALL tokens is not the answer either: a token is minted on every visit
-- to /qr, so most rows describe a code nobody ever pointed a camera at and carry
-- no information at all.
--
-- So the sweep now keeps only the rows that say something: scan_count > 0
-- survives, scan_count = 0 is still swept an hour after expiry. Growth is
-- therefore bounded by actual scans rather than by page views, which is both the
-- smaller number and the meaningful one. run_retention prunes the survivors at
-- 90 days.
-- ============================================================================

create or replace function mint_qr_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Sweeps only tokens that were never scanned. A scanned token is the analytics
  -- record for that scan (see networking_stats below) and is kept until
  -- run_retention prunes it at 90 days.
  delete from qr_tokens
   where profile_id = auth.uid()
     and expires_at < now() - interval '1 hour'
     and scan_count = 0;

  -- MUST stay above qr-editor.tsx's REFRESH_MARGIN_MS (90s). Dropping this to or
  -- below the client's margin makes the refresh return the same token, which
  -- silently stops the QR screen refreshing — see 20260729120000.
  select token, expires_at into v_token, v_expires
    from qr_tokens
   where profile_id = auth.uid()
     and expires_at > now() + interval '2 minutes'
   order by expires_at desc
   limit 1;

  if found then
    return jsonb_build_object('token', v_token, 'expires_at', v_expires);
  end if;

  if not private.rate_limit_ok(auth.uid(), 'mint_qr', 60, interval '1 hour') then
    raise exception 'qr mint rate limit exceeded' using errcode = '53400';
  end if;

  -- §8: a soft-deleted account must not be able to mint a scannable code.
  if not exists (
    select 1 from profiles where id = auth.uid() and deleted_at is null
  ) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  insert into qr_tokens (profile_id, expires_at)
  values (auth.uid(), now() + interval '15 minutes')
  returning token, expires_at into v_token, v_expires;

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

revoke all on function mint_qr_token() from public, anon;
grant execute on function mint_qr_token() to authenticated;


-- ---------------------------------------------------------------------------
-- run_retention — prune the surviving scanned tokens
-- ---------------------------------------------------------------------------
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
  v_qr int;
begin
  with doomed as (
    select id from profile_change_events
     where processed_at is not null
       and processed_at < now() - interval '90 days'
     limit p_batch
  )
  delete from profile_change_events e using doomed d where e.id = d.id;
  get diagnostics v_events = row_count;

  with doomed as (
    select id from notifications
     where read_at is not null
       and read_at < now() - interval '180 days'
     limit p_batch
  )
  delete from notifications n using doomed d where n.id = d.id;
  get diagnostics v_notifications = row_count;

  with doomed as (
    select id from rate_events
     where created_at < now() - interval '1 day'
     limit p_batch
  )
  delete from rate_events r using doomed d where r.id = d.id;
  get diagnostics v_rate = row_count;

  -- Scanned tokens outlive their expiry as the scan record. 90 days matches the
  -- change-event window and is comfortably longer than the 12 weeks the
  -- analytics page charts.
  with doomed as (
    select token from qr_tokens
     where expires_at < now() - interval '90 days'
     limit p_batch
  )
  delete from qr_tokens q using doomed d where q.token = d.token;
  get diagnostics v_qr = row_count;

  return jsonb_build_object(
    'change_events', v_events,
    'notifications', v_notifications,
    'rate_events', v_rate,
    'qr_tokens', v_qr,
    'more', (v_events = p_batch or v_notifications = p_batch
             or v_rate = p_batch or v_qr = p_batch)
  );
end;
$$;

revoke all on function run_retention(int) from public, anon, authenticated;
grant execute on function run_retention(int) to service_role;


-- ---------------------------------------------------------------------------
-- networking_stats — everything the analytics page renders, in one round trip
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because qr_tokens is deny-all to clients by design (a client
-- that could read it could read every live token in the system). Every statement
-- below is therefore scoped to auth.uid() BY HAND — there is no RLS underneath
-- this to catch a mistake.
--
-- WHAT IS DELIBERATELY ABSENT: "who saved my card", and any count of it.
-- contact_saves is owner-only under a policy whose own comment calls the inverse
-- "a surveillance signal nobody consented to at scan time". An aggregate is the
-- same signal at lower resolution — with two connections, "1 person saved your
-- card" names them. So this reports what the caller SAVED, never who saved the
-- caller.
create or replace function networking_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_weeks jsonb;
  v_active int;
  v_new_30 int;
  v_new_prev_30 int;
  v_scans_30 int;
  v_scans_total int;
  v_saved int;
  v_stale int;
  v_first timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Active connections, and the two 30-day windows the headline delta compares.
  -- disconnected_at is null is what "active" means (§5.6 soft delete).
  select
    count(*) filter (where disconnected_at is null),
    count(*) filter (where connected_at >= now() - interval '30 days'),
    count(*) filter (where connected_at >= now() - interval '60 days'
                       and connected_at <  now() - interval '30 days'),
    min(connected_at)
  into v_active, v_new_30, v_new_prev_30, v_first
  from connections
  where user_a = me or user_b = me;

  -- Scans OF THIS USER'S codes. Unscanned expired tokens are swept, so this
  -- undercounts nothing that was ever scanned, and counts nothing that wasn't.
  select coalesce(sum(scan_count), 0),
         coalesce(sum(scan_count) filter (where last_scanned_at >= now() - interval '30 days'), 0)
    into v_scans_total, v_scans_30
    from qr_tokens
   where profile_id = me;

  select count(*) into v_saved from contact_saves where owner_id = me;

  -- Cards worth re-saving: the other person has edited their profile since the
  -- caller last downloaded their card. updated_at rather than profile_version
  -- because contact_saves records a TIME, not a version — see its migration on
  -- why this is a lower bound rather than a guarantee.
  select count(*) into v_stale
    from connections c
    join contact_saves s
      on s.owner_id = me
     and s.subject_id = case when c.user_a = me then c.user_b else c.user_a end
    join profiles p on p.id = s.subject_id
   where (c.user_a = me or c.user_b = me)
     and c.disconnected_at is null
     and p.deleted_at is null
     and p.updated_at > s.saved_at;

  -- Twelve weeks of both series, generated from a calendar rather than from the
  -- data so a week with no activity is a real zero instead of a missing bar.
  with weeks as (
    select generate_series(
             date_trunc('week', now()) - interval '11 weeks',
             date_trunc('week', now()),
             interval '1 week'
           ) as week_start
  )
  select jsonb_agg(
           jsonb_build_object(
             'week_start', w.week_start::date,
             'connections', (
               select count(*) from connections c
                where (c.user_a = me or c.user_b = me)
                  and c.connected_at >= w.week_start
                  and c.connected_at <  w.week_start + interval '1 week'
             ),
             'scans', (
               select coalesce(sum(t.scan_count), 0) from qr_tokens t
                where t.profile_id = me
                  and t.last_scanned_at >= w.week_start
                  and t.last_scanned_at <  w.week_start + interval '1 week'
             )
           )
           order by w.week_start
         )
    into v_weeks
    from weeks w;

  return jsonb_build_object(
    'active', v_active,
    'new_30d', v_new_30,
    'new_prev_30d', v_new_prev_30,
    'scans_30d', v_scans_30,
    'scans_total', v_scans_total,
    'saved', v_saved,
    'unsaved', greatest(v_active - v_saved, 0),
    'stale', v_stale,
    'first_connection_at', v_first,
    'weeks', coalesce(v_weeks, '[]'::jsonb)
  );
end;
$$;

revoke all on function networking_stats() from public, anon;
grant execute on function networking_stats() to authenticated;

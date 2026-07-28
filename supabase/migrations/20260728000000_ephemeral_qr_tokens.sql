-- ============================================================================
-- §6 revision: QR codes expire.
--
-- profiles.qr_token was PERMANENT. That made a screenshot of someone's code a
-- credential with no expiry: photograph a QR at a conference, connect to that
-- person any time later, and nothing in the system could tell the difference
-- between that and a real scan. Rotation existed but was manual, so in practice
-- every code was forever.
--
-- Replaced by short-lived tokens minted for the live QR screen. A code is valid
-- for 15 minutes from minting and unlimited scans inside that window — the
-- conference-badge case (fifty people scanning one displayed code) is the
-- product working, not an attack, which is why this is time-limited rather than
-- single-use.
--
-- THE PERMANENT COLUMN IS DROPPED, NOT LEFT UNUSED. Leaving it would keep a
-- never-expiring code resolvable in a system whose whole point is that no code
-- is permanent, and would read to any future maintainer as the live scan path.
-- Printed codes, stickers and email signatures stop working by design: a
-- screenshot being useless and a sticker being useless are the same property.
-- ============================================================================

create table qr_tokens (
  token text primary key default gen_random_uuid()::text,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- The audit trail a permanent token could never give: which specific minted
  -- code a connection came through, and how many times it was used.
  scan_count int not null default 0,
  last_scanned_at timestamptz
);

-- Serves the "is there a live token for this user" lookup in mint_qr_token.
create index qr_tokens_profile_live_idx on qr_tokens (profile_id, expires_at desc);
-- Serves expiry sweeps.
create index qr_tokens_expires_idx on qr_tokens (expires_at);

alter table qr_tokens enable row level security;

-- RLS on with ZERO policies denies everything, which is exactly right: no client
-- ever touches this table directly. Minting goes through mint_qr_token() and
-- resolution through connect_via_scan(), both SECURITY DEFINER. A client that
-- could read this table could enumerate live tokens for every user; a client
-- that could write it could choose its own token, and a chosen token is a
-- guessable one — the same reasoning that kept qr_token out of the column
-- grants in §4.
revoke all on qr_tokens from anon, authenticated;


-- ---------------------------------------------------------------------------
-- mint_qr_token — called when the QR screen renders and when it refreshes
-- ---------------------------------------------------------------------------
-- Returns the LIVE token rather than minting on every call. Without that, every
-- page render, tab focus and style tweak would mint a new row and change the
-- code under a scanner mid-scan. The one-minute floor means a token handed out
-- here always has enough life left to actually be scanned; the client refreshes
-- at that boundary, so the displayed code is never close to expiry.
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

  -- Self-maintaining cleanup: each user sweeps their own expired rows on the
  -- way past, so the table stays bounded with no cron behind it. Vercel Hobby
  -- allows one cron a day (see WORKER_MODE in .env.example) and spending it on
  -- this would be a poor trade.
  delete from qr_tokens
   where profile_id = auth.uid()
     and expires_at < now() - interval '1 hour';

  select token, expires_at into v_token, v_expires
    from qr_tokens
   where profile_id = auth.uid()
     and expires_at > now() + interval '1 minute'
   order by expires_at desc
   limit 1;

  if found then
    return jsonb_build_object('token', v_token, 'expires_at', v_expires);
  end if;

  -- Honest use needs four mints an hour. This bounds a scripted client farming
  -- live tokens to hand out elsewhere, which is the only way to rebuild the
  -- permanent-code problem this migration exists to remove.
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
-- rotate_qr_token — now "reset my code", i.e. kill every live token
-- ---------------------------------------------------------------------------
-- Return type changes from text to jsonb, so it has to be dropped rather than
-- replaced. Still worth having even though codes now expire on their own: the
-- point is IMMEDIACY. Someone who has just realised their screen was
-- photographed should not have to wait out the remaining fifteen minutes.
drop function if exists rotate_qr_token();

create or replace function rotate_qr_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not private.rate_limit_ok(auth.uid(), 'rotate_token', 10, interval '1 hour') then
    raise exception 'token rotation rate limit exceeded' using errcode = '53400';
  end if;

  -- Every outstanding code for this user dies here, not just the displayed one.
  -- A second device showing an older token is exactly what this needs to catch.
  delete from qr_tokens where profile_id = auth.uid();

  return mint_qr_token();
end;
$$;

revoke all on function rotate_qr_token() from public, anon;
grant execute on function rotate_qr_token() to authenticated;


-- ---------------------------------------------------------------------------
-- connect_via_scan — resolve through qr_tokens, and record the scan
-- ---------------------------------------------------------------------------
-- Only the token resolution and the new scan bookkeeping change. Everything
-- else is carried over verbatim from 20260727200100 — the rate limits, the
-- block asymmetry, the reactivation watermarks, the unique_violation handler
-- and its dependency on the pre-check, and the notification insert.
create or replace function connect_via_scan(scanned_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scanner_id uuid := auth.uid();
  target_id uuid;
  target_deleted timestamptz;
  existing connections%rowtype;
  v_epoch int;
  v_status text;
begin
  if scanner_id is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  if not private.rate_limit_ok(scanner_id, 'scan', 30, interval '1 minute') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- An EXPIRED token and a token that never existed are deliberately the same
  -- answer, for the same reason a block reads as invalid_token: the response
  -- must not confirm that a given code was ever real. The screenshot case is
  -- precisely someone probing a code they know used to work.
  select t.profile_id, p.deleted_at into target_id, target_deleted
    from qr_tokens t
    join profiles p on p.id = t.profile_id
   where t.token = scanned_token
     and t.expires_at > now();

  if target_id is null or target_deleted is not null then
    if not private.rate_limit_ok(scanner_id, 'scan_failed', 15, interval '1 hour')
       or not private.rate_limit_ok(
              scanner_id, 'scan_failed_token', 30, interval '1 hour', scanned_token) then
      return jsonb_build_object('status', 'rate_limited');
    end if;
    return jsonb_build_object('status', 'invalid_token');
  end if;

  -- Recorded on RESOLUTION, before the outcome is known, so the trail includes
  -- self-scans and scans by blocked users. A trail that only logged successes
  -- would be blind to exactly the patterns worth looking at later.
  update qr_tokens
     set scan_count = scan_count + 1,
         last_scanned_at = now()
   where token = scanned_token;

  if target_id = scanner_id then
    return jsonb_build_object('status', 'self_scan');
  end if;

  if private.is_blocked(scanner_id, target_id) then
    if private.has_blocked(scanner_id, target_id) then
      return jsonb_build_object('status', 'blocked');
    end if;
    return jsonb_build_object('status', 'invalid_token');
  end if;

  select * into existing
    from connections
   where least(user_a, user_b) = least(scanner_id, target_id)
     and greatest(user_a, user_b) = greatest(scanner_id, target_id);

  if found then
    if existing.disconnected_at is null then
      v_status := 'already_connected';
      v_epoch := existing.connection_epoch;
    else
      if not private.rate_limit_ok(scanner_id, 'new_connection', 60, interval '1 hour') then
        return jsonb_build_object('status', 'rate_limited');
      end if;

      update connections
         set disconnected_at = null,
             connected_at = now(),
             connection_epoch = connection_epoch + 1,
             a_notified_version = (select profile_version from profiles where id = existing.user_b),
             b_notified_version = (select profile_version from profiles where id = existing.user_a)
       where id = existing.id
      returning connection_epoch into v_epoch;
      v_status := 'new_connection';
    end if;
  else
    if not private.rate_limit_ok(scanner_id, 'new_connection', 60, interval '1 hour') then
      return jsonb_build_object('status', 'rate_limited');
    end if;

    begin
      insert into connections (user_a, user_b, a_notified_version, b_notified_version)
      values (
        scanner_id,
        target_id,
        (select profile_version from profiles where id = target_id),
        (select profile_version from profiles where id = scanner_id)
      )
      returning connection_epoch into v_epoch;
      v_status := 'new_connection';
    exception when unique_violation then
      -- Only sound because the pre-check above established no row existed, so
      -- the conflicting row was inserted concurrently and is therefore active.
      select connection_epoch, disconnected_at into v_epoch, target_deleted
        from connections
       where least(user_a, user_b) = least(scanner_id, target_id)
         and greatest(user_a, user_b) = greatest(scanner_id, target_id);
      v_status := 'already_connected';
    end;
  end if;

  if v_status = 'new_connection' then
    insert into notifications
      (recipient_id, source_profile_id, type, change_version, dedupe_seq)
    values (target_id, scanner_id, 'new_connection', null, v_epoch)
    on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'connection_epoch', v_epoch,
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'photo_url', p.photo_url,
        'bio', p.bio,
        'phone', cd.phone,
        'email', cd.email,
        'custom_fields', coalesce((
          select jsonb_agg(
                   jsonb_build_object('label', cf.label, 'value', cf.value)
                   order by cf.sort_order, cf.created_at
                 )
            from custom_fields cf
           where cf.profile_id = p.id
             and cf.is_public   -- DEFINER bypasses RLS; filter by hand
        ), '[]'::jsonb)
      )
      from profiles p
      left join contact_details cd on cd.profile_id = p.id
      where p.id = target_id
    )
  );
end;
$$;

revoke all on function connect_via_scan(text) from public, anon;
grant execute on function connect_via_scan(text) to authenticated;


-- ---------------------------------------------------------------------------
-- Account deletion (§8) — kill outstanding codes
-- ---------------------------------------------------------------------------
-- The old version rotated qr_token to stop printed codes resolving. That column
-- is gone, so the equivalent is deleting the live tokens. Without this a
-- deleted account stays scannable until its last token expires — connect_via_scan
-- rejects it on deleted_at, but leaving resolvable rows behind for an account
-- that asked to be gone is not a state worth having.
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

  delete from contact_details where profile_id = me;
  delete from custom_fields where profile_id = me;
  delete from push_subscriptions where profile_id = me;
  delete from notifications where recipient_id = me;
  delete from blocks where blocker_id = me;
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

  -- connections are left untouched on purpose — see the original migration.
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;


-- ---------------------------------------------------------------------------
-- Finally: remove the permanent code.
-- ---------------------------------------------------------------------------
-- Dropped LAST, so every function above has already been redefined to stop
-- referencing it.
alter table profiles drop column qr_token;

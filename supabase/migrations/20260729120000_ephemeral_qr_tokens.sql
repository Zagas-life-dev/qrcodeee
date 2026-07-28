-- ============================================================================
-- §6 revision: QR codes expire. Ephemeral 15-minute tokens replace the
-- permanent profiles.qr_token.
--
-- THE PROBLEM WITH THE OLD DESIGN. profiles.qr_token was minted once and lived
-- forever. Anyone who photographed a code — over a shoulder, off a badge, from a
-- group chat where it was shared once — held a working connect credential
-- indefinitely, and the only remedy was the owner noticing and manually
-- rotating. §6 called the token "a discovery mechanism, not an identity", which
-- is exactly why it can be made ephemeral without touching anything else:
-- connections reference profiles.id and never the token.
--
-- WHY A TABLE RATHER THAN A TIMED ROTATION OF THE COLUMN. Rotating the column
-- every 15 minutes needs a scheduled sweep across every user, which this
-- deployment cannot afford (see WORKER_MODE in .env.example — Vercel Hobby cron
-- is already being rationed), and it still would not expire the code of someone
-- who never opens the app. Minting on demand expires by the passage of time
-- alone, with nothing scheduled anywhere.
--
-- WHY A TABLE RATHER THAN A DERIVED HMAC. A TOTP-style code needs no storage at
-- all and was the other real candidate. It was not chosen because it cannot
-- answer "which code was scanned, and when" — every code for a given 15-minute
-- bucket is the same string, so there is nothing to audit and no way to revoke
-- one code without revoking them all. scan_count / last_scanned_at below are the
-- whole reason for the extra table.
--
-- TIME WINDOW, NOT SINGLE USE. A token stays valid for every scan inside its
-- window. Burning it on first scan would break the product's best case — a code
-- held up to a group, scanned by four people in a row — in exactly the way the
-- per-token rate limit in 20260727200100 already declined to.
-- ============================================================================

create table qr_tokens (
  token text primary key default gen_random_uuid()::text,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- The audit trail, and the reason this is a table. A token that was scanned
  -- forty times in ten minutes and one that was never scanned at all are
  -- different facts, and neither is recoverable from a derived code.
  scan_count int not null default 0,
  last_scanned_at timestamptz
);

-- Covers the mint path's "is there still a live token for this user".
create index qr_tokens_profile_live_idx on qr_tokens (profile_id, expires_at desc);
-- Covers the sweep of expired rows.
create index qr_tokens_expires_idx on qr_tokens (expires_at);

-- RLS on with NO policies: deny-all. Deliberate rather than an omission.
-- Clients never read or write this table directly — minting goes through
-- mint_qr_token() and resolution through connect_via_scan(), both SECURITY
-- DEFINER. A client that could SELECT here could read every live token in the
-- system, which is the one thing this whole migration exists to prevent.
alter table qr_tokens enable row level security;
revoke all on qr_tokens from anon, authenticated;


-- ---------------------------------------------------------------------------
-- mint_qr_token — called when the QR screen renders, and on its refresh timer
-- ---------------------------------------------------------------------------
-- Returns the live token if one has meaningful life left, rather than minting on
-- every render. Without that, opening /qr twice would strand a token that is
-- still displayed on another device, and every navigation would burn a row.
--
-- THE TWO-MINUTE FLOOR MUST STAY ABOVE THE CLIENT'S REFRESH MARGIN.
-- qr-editor.tsx refreshes at REFRESH_MARGIN_MS (90s) before expiry. If this
-- floor were at or below that, the refresh call would land while the token still
-- qualified for reuse and get the SAME token back — the client's setExpiry()
-- would then be a no-op, its effect would never re-run, no new timer would be
-- scheduled, and the code would sit on screen until it silently expired. The
-- failure is invisible from the QR screen: it looks fine and scanners just get
-- "this code is no longer active". Raising REFRESH_MARGIN_MS without raising
-- this reintroduces it.
--
-- The margin is on the display side rather than a grace window on the scan side
-- on purpose: it keeps a live code on screen without ever extending how long a
-- photographed one keeps working.
create or replace function mint_qr_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_token text;
  v_expires timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Self-maintaining: each mint clears this user's own dead rows, so the table
  -- stays bounded with nothing scheduled. Cheap — it is an index range scan over
  -- one user's handful of rows, not a global sweep.
  delete from qr_tokens where profile_id = me and expires_at <= now();

  select token, expires_at into v_token, v_expires
    from qr_tokens
   where profile_id = me
     and expires_at > now() + interval '2 minutes'
   order by expires_at desc
   limit 1;

  if found then
    return jsonb_build_object('token', v_token, 'expires_at', v_expires);
  end if;

  -- Honest use needs four mints an hour. This bounds a scripted client farming
  -- live tokens; it cannot be tripped by a person looking at their own code.
  if not private.rate_limit_ok(me, 'mint_qr', 60, interval '1 hour') then
    raise exception 'qr mint rate limit exceeded' using errcode = '53400';
  end if;

  -- A soft-deleted account must not be able to hand out a scannable code (§8).
  if not exists (select 1 from profiles where id = me and deleted_at is null) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  insert into qr_tokens (profile_id, expires_at)
  values (me, now() + interval '15 minutes')
  returning token, expires_at into v_token, v_expires;

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

revoke all on function mint_qr_token() from public, anon;
grant execute on function mint_qr_token() to authenticated;


-- ---------------------------------------------------------------------------
-- rotate_qr_token — "reset my code", now an immediate kill of every live token
-- ---------------------------------------------------------------------------
-- Return type changes from text to jsonb, so this has to be dropped rather than
-- replaced. Its meaning changes with it: there is no longer a permanent token to
-- swap, so resetting means invalidating every unexpired token and handing back a
-- fresh one. This is what someone reaches for when a code was shared somewhere
-- it shouldn't have been and they don't want to wait out the 15 minutes.
drop function if exists rotate_qr_token();

create or replace function rotate_qr_token()
returns jsonb
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

  if not private.rate_limit_ok(me, 'rotate_token', 10, interval '1 hour') then
    raise exception 'token rotation rate limit exceeded' using errcode = '53400';
  end if;

  delete from qr_tokens where profile_id = me;

  -- Delegated so the mint path stays single: one place decides TTL, one place
  -- checks for a soft-deleted profile.
  return mint_qr_token();
end;
$$;

revoke all on function rotate_qr_token() from public, anon;
grant execute on function rotate_qr_token() to authenticated;


-- ---------------------------------------------------------------------------
-- connect_via_scan — resolve through qr_tokens, and record the scan
-- ---------------------------------------------------------------------------
-- Only the token resolution at the top and the new scan bookkeeping differ from
-- 20260727200100. Everything below the resolution is carried over verbatim and
-- deliberately: the blocked/expired conflation, the pre-check that makes the
-- unique_violation handler sound, the watermark seeding, and the notification
-- insert all still apply exactly as documented there.
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

  -- The expiry check lives in the WHERE clause, so an expired token is
  -- indistinguishable from one that never existed — same invalid_token the
  -- blocked path returns, and the §5.1 copy ("this code is no longer active")
  -- already reads correctly for it.
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

  -- Recorded on resolution rather than on a successful connection: a self_scan
  -- and a scan by someone already connected are both real uses of the code, and
  -- an audit trail that only counts the outcomes we liked is not an audit trail.
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


-- ---------------------------------------------------------------------------
-- delete_my_account — kill live tokens instead of rotating a column that is
-- about to stop existing
-- ---------------------------------------------------------------------------
-- The FK cascades, but soft delete leaves the profiles row in place, so nothing
-- would remove these without saying so. A code minted moments before someone
-- deleted their account must stop resolving immediately.
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

  -- STEP 0, AND IT MUST BE FIRST — see 20260727210000 for the full reasoning.
  -- Without this every step below fans out change notifications to every
  -- connection this user ever had.
  perform set_config('app.suppress_change_events', 'on', true);

  delete from custom_fields where profile_id = me;
  delete from contact_details where profile_id = me;

  delete from push_subscriptions where profile_id = me;
  delete from notifications where recipient_id = me;
  delete from blocks where blocker_id = me;

  -- Replaces the qr_token rotation this function used to do.
  delete from qr_tokens where profile_id = me;

  -- `reports` this user FILED are deliberately kept — see 20260727210000.

  update profiles
     set name = 'Deleted account',
         photo_url = null,
         bio = null,
         deleted_at = now()
   where id = me
     and deleted_at is null;
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;


-- ---------------------------------------------------------------------------
-- Finally: remove the permanent token itself
-- ---------------------------------------------------------------------------
-- Dropped rather than left in place. A dead column that still looks like the
-- scan path is a trap — the next person to read this schema would reasonably
-- conclude permanent codes still resolve, and any code that starts consulting it
-- again silently reinstates exactly the weakness this migration removes.
alter table profiles drop column qr_token;

-- ============================================================================
-- Handles everywhere a connection is named (§6 / site-spec S3).
--
-- WHY. A scan no longer lands on /connect/{token} — that route redeems the
-- token and redirects to the scanned person's public page, which is now the only
-- page a person has in this product. Two call sites therefore need a HANDLE
-- where they previously only needed a profile id:
--
--   * the redemption route, to know where to send the scanner;
--   * the connections list, whose rows now open /u/{handle} rather than a
--     per-connection detail page that no longer exists.
--
-- Both could look the handle up separately. Returning it from the functions that
-- already read the row is one round trip instead of two, and — for the redirect —
-- it is the handle of the profile the TOKEN resolved to rather than the one that
-- happened to be in the URL, which is the difference between landing on the
-- person you scanned and landing wherever a hand-crafted link said.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- search_connections — + handle
-- ---------------------------------------------------------------------------
-- The return type changes, so this has to be dropped rather than replaced;
-- `create or replace` cannot alter a function's OUT columns. Same shape as the
-- rotate_qr_token replacement in 20260728000000.
--
-- STILL SECURITY INVOKER. That is the whole design of this function and it must
-- not change: running as the caller means the `connections` SELECT policy (own,
-- active, unblocked) and the `profiles` policy (not blocked) both still apply,
-- so it contains no authorization logic of its own and cannot drift from the
-- policies. `handle` is on `profiles` and is public by policy, so it is exposed
-- here on exactly the terms it is exposed everywhere else.
drop function if exists search_connections(text, int, int);

create or replace function search_connections(
  p_query text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  connection_id uuid,
  profile_id uuid,
  name text,
  handle text,
  photo_url text,
  deleted_at timestamptz,
  connected_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select c.id, c.connected_at,
           case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id
      from connections c
  ),
  joined as (
    select m.id, m.connected_at,
           p.id as pid, p.name, p.handle, p.photo_url, p.deleted_at
      from mine m
      join profiles p on p.id = m.other_id
     where p_query is null
        or btrim(p_query) = ''
        -- % and _ are ILIKE wildcards, so a user searching for "50%" would
        -- otherwise match everything. Escaped, with the backslash escaped first
        -- so it can't double-escape the escapes.
        or p.name ilike '%' || replace(replace(replace(
             btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  )
  select j.id, j.pid, j.name, j.handle, j.photo_url, j.deleted_at, j.connected_at,
         -- Window function rather than a second count query: one round trip, and
         -- the count is guaranteed consistent with the page being returned.
         count(*) over () as total_count
    from joined j
   order by j.connected_at desc, j.id
   limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

revoke all on function search_connections(text, int, int) from public;
revoke all on function search_connections(text, int, int) from anon;
grant execute on function search_connections(text, int, int) to authenticated;


-- ---------------------------------------------------------------------------
-- connect_via_scan — + handle in the returned profile
-- ---------------------------------------------------------------------------
-- Carried over verbatim from 20260728000000. The ONLY change is `'handle',
-- p.handle` in the returned jsonb — the rate limits, the block asymmetry, the
-- reactivation watermarks, the unique_violation handler and its dependency on
-- the pre-check, and the notification insert are all untouched. The signature
-- and return type are unchanged, so `create or replace` is enough.
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
    -- The handle rides along so the redemption route can send someone who
    -- scanned their own code to their own page rather than to whatever handle
    -- was in the URL they arrived on.
    return jsonb_build_object(
      'status', 'self_scan',
      'profile', jsonb_build_object(
        'id', scanner_id,
        'handle', (select handle from profiles where id = scanner_id)
      )
    );
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
        -- Where the scanner is sent next. Resolved from the TOKEN, never from
        -- the URL they arrived on.
        'handle', p.handle,
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

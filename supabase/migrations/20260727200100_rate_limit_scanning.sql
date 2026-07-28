-- ============================================================================
-- §7 scan limits, applied inside connect_via_scan and rotate_qr_token.
--
-- A QR token is a publicly shareable credential, so scanning needs limits from
-- day one. Adds a `rate_limited` status to the §5.1 set.
--
-- ONE LIMIT §7 LISTS IS DELIBERATELY NOT IMPLEMENTED AS WRITTEN.
-- "Per token: cap repeated failed/invalid scan attempts against the same token."
-- Capping SUCCESSFUL scans per token would break the product's best case: a QR
-- code on a conference badge scanned by fifty people in ten minutes is the
-- success condition, not an attack, and a per-token cap would start turning away
-- legitimate new connections exactly when the app is working. So the per-token
-- limit here counts FAILED attempts only — a live token produces no failures, so
-- honest use can never trip it, while hammering a rotated-out token can.
--
-- Worth noting the threat this is really guarding: qr_token is
-- gen_random_uuid(), 122 bits of entropy, so guessing one is not a realistic
-- attack (§6 says as much). The practical value of these caps is bounding
-- enumeration attempts and stopping a scripted client from generating
-- connection churn.
-- ============================================================================

create or replace function rotate_qr_token()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Rotation invalidates every printed code, so a runaway loop is a good way to
  -- make your own QR permanently useless. Bounded generously.
  if not private.rate_limit_ok(auth.uid(), 'rotate_token', 10, interval '1 hour') then
    raise exception 'token rotation rate limit exceeded' using errcode = '53400';
  end if;

  update profiles
     set qr_token = gen_random_uuid()::text
   where id = auth.uid()
     and deleted_at is null
  returning qr_token into new_token;

  if new_token is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  return new_token;
end;
$$;


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

  -- Every scan attempt counts, valid or not. Checked FIRST, before the token is
  -- even resolved, so a scripted client can't use this function as a lookup
  -- oracle at whatever rate it likes.
  if not private.rate_limit_ok(scanner_id, 'scan', 30, interval '1 minute') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select id, deleted_at into target_id, target_deleted
    from profiles
   where qr_token = scanned_token;

  if target_id is null or target_deleted is not null then
    -- Failed attempts are counted twice: per scanner (someone enumerating) and
    -- per token (a dead token being hammered, possibly from several accounts).
    -- Both record only on this path, so a working code never accumulates either.
    if not private.rate_limit_ok(scanner_id, 'scan_failed', 15, interval '1 hour')
       or not private.rate_limit_ok(
              scanner_id, 'scan_failed_token', 30, interval '1 hour', scanned_token) then
      return jsonb_build_object('status', 'rate_limited');
    end if;
    return jsonb_build_object('status', 'invalid_token');
  end if;

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
      -- Re-scanning someone you're already connected to costs nothing and
      -- creates nothing, so it is not counted against the connection budget.
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
      -- Re-read rather than assume; see the original migration's note.
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

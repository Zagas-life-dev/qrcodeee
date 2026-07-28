-- ============================================================================
-- §5.1 scan -> mutual connect, and §6 QR token rotation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rotate_qr_token — referenced by §4 ("qr_token rotation ... goes through its
-- own SECURITY DEFINER RPC") but never written out there.
-- ---------------------------------------------------------------------------
-- Needs DEFINER because qr_token is deliberately absent from the column grants:
-- letting a client write it directly would let them CHOOSE a token rather than
-- receive a random one, and a chosen token is a guessable one.
--
-- Rotation invalidates the old token for new scans but does NOT touch existing
-- connections — those reference profiles.id, never the token (§6). The token is
-- a discovery mechanism, not an identity. It also must not bump profile_version
-- (§5.4 table): nobody's saved contact card changed, so nobody should be
-- notified. The WHEN clause on profiles_bump_version already excludes qr_token,
-- so this is free — but it's the reason this can't be folded into a general
-- "update my profile" path.
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

revoke all on function rotate_qr_token() from public;
grant execute on function rotate_qr_token() to authenticated;


-- ---------------------------------------------------------------------------
-- connect_via_scan — the whole product in one function (§5.1)
-- ---------------------------------------------------------------------------
-- Returns a STRUCTURED STATUS rather than succeed/fail, so the frontend can
-- respond precisely instead of showing a generic error toast:
--
--   {"status":"new_connection",    "profile":{...}, "connection_epoch":n}
--   {"status":"already_connected", "profile":{...}, "connection_epoch":n}
--   {"status":"self_scan"}
--   {"status":"invalid_token"}
--   {"status":"blocked"}
--   {"status":"unauthenticated"}   -- not in §5.1's list; see below
--
-- SECURITY DEFINER is required: clients cannot write `connections` at all (§4).
-- That makes the following non-negotiable, because RLS is no longer helping:
--   * the scanner is ALWAYS auth.uid(), never an argument
--   * the target is resolved STRICTLY from the token, never a supplied id
--   * only the two profiles involved in this call are ever returned
--   * private custom fields are excluded by hand, since RLS isn't doing it
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
  -- Not one of §5.1's five statuses. The landing page is supposed to preserve
  -- the token through login and only call this once authenticated, so reaching
  -- here logged-out is a client bug — but returning a distinct status lets the
  -- page recover by redirecting instead of showing "this code is invalid" for a
  -- code that is perfectly valid.
  if scanner_id is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  select id, deleted_at into target_id, target_deleted
    from profiles
   where qr_token = scanned_token;

  -- Soft-deleted targets are invalid. This check must live HERE: the function
  -- runs DEFINER so it bypasses RLS, and per §8 the profiles policy deliberately
  -- no longer filters deleted rows either. Nothing else would catch it.
  if target_id is null or target_deleted is not null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  if target_id = scanner_id then
    return jsonb_build_object('status', 'self_scan');
  end if;

  -- Blocks are checked BEFORE touching `connections` at all, so a blocked pair
  -- can neither create nor reactivate anything.
  --
  -- The asymmetry in the response is the point. Naming the block to the person
  -- who PLACED it tells them nothing they don't know. Naming it to the person
  -- who RECEIVED it confirms that one specific individual blocked them — which
  -- is exactly the fact the `blocks` RLS policy exists to withhold. So they get
  -- the same invalid_token the expired-code path returns, and §5.5 deliberately
  -- has no "you have been blocked" toast to go with it.
  if private.is_blocked(scanner_id, target_id) then
    if private.has_blocked(scanner_id, target_id) then
      return jsonb_build_object('status', 'blocked');
    end if;
    return jsonb_build_object('status', 'invalid_token');
  end if;

  -- Look the pair up FIRST, matching on the unordered pair the same way the
  -- unique index does. This pre-check is what makes the exception handler below
  -- sound — see the comment there before refactoring it away.
  select * into existing
    from connections
   where least(user_a, user_b) = least(scanner_id, target_id)
     and greatest(user_a, user_b) = greatest(scanner_id, target_id);

  if found then
    if existing.disconnected_at is null then
      v_status := 'already_connected';
      v_epoch := existing.connection_epoch;
    else
      -- Reactivate rather than insert: the unique index matches the pair
      -- regardless of state, so a fresh insert would just conflict.
      --
      -- Watermarks are reset to each side's CURRENT view of the other, not left
      -- as they were. Otherwise reconnecting after six months dumps a
      -- notification about every change made while disconnected.
      --
      -- The a/b mapping is slot-based, not scanner-based: user_a may be either
      -- party. a_notified_version tracks how current A is on *B's* profile, so
      -- it reads from existing.user_b, and vice versa. Getting this backwards is
      -- silent — both are ints and both exist.
      --
      -- Bumping connection_epoch is what lets this produce a SECOND
      -- new_connection notification; the idempotency index would otherwise treat
      -- the pair as already-notified forever (§3).
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
    begin
      -- Watermarks matter on the FIRST connection for the same reason they
      -- matter on a reconnect, and this is the easier one to overlook because a
      -- column default would silently cover for it — which is precisely why §3
      -- gives these columns no default. Connecting to a profile already at
      -- version 47 with a default of 1 would start you 46 versions behind, and
      -- their next trivial bio edit would trip the accumulated-changes threshold
      -- and announce 46 changes that all happened before you met.
      --
      -- Both versions are read inside this one statement, per §5.1.
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
      -- Simultaneous scans: A and B scanned each other at the same moment and
      -- the other transaction won.
      --
      -- Returning already_connected outright is only correct BECAUSE the
      -- pre-check above established no row existed. That means the conflicting
      -- row was inserted by a concurrent transaction, and a freshly inserted row
      -- is always active. If the pre-check is ever refactored away, this handler
      -- starts returning already_connected for a DISCONNECTED row and
      -- reconnection breaks with no error anywhere. Re-read rather than assume.
      select connection_epoch, disconnected_at into v_epoch, target_deleted
        from connections
       where least(user_a, user_b) = least(scanner_id, target_id)
         and greatest(user_a, user_b) = greatest(scanner_id, target_id);
      v_status := 'already_connected';
    end;
  end if;

  -- §5.1: this is connect_via_scan's job, not the background worker's. The
  -- worker is driven entirely by profile_change_events, and connecting produces
  -- no change event — so without this insert the scanned person's entire
  -- notification path has no write behind it, and Web Push (the ONLY way to
  -- reach them while their app is closed) never fires.
  --
  -- Only the scanned person gets a row. The scanner is looking at the result on
  -- screen. dedupe_seq is the connection epoch, NOT a version — that is what
  -- makes each reactivation genuinely distinct (§3).
  if v_status = 'new_connection' then
    insert into notifications
      (recipient_id, source_profile_id, type, change_version, dedupe_seq)
    values (target_id, scanner_id, 'new_connection', null, v_epoch)
    on conflict (recipient_id, source_profile_id, type, dedupe_seq) do nothing;
  end if;

  -- Contact details come back in this same response. Once the row exists the
  -- contact_details policy already permits both sides to read each other's
  -- phone/email, so there is no separate unlock step — but note this is built
  -- AFTER the insert/reactivation above, never before, so success is never
  -- reported for a connection that didn't land (§5.1).
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

revoke all on function connect_via_scan(text) from public;
-- authenticated only. An anonymous scan is handled by preserving the token
-- through login (§5.1), not by connecting as nobody.
grant execute on function connect_via_scan(text) to authenticated;

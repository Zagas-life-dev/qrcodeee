-- ============================================================================
-- Fix: mint_qr_token's reuse floor sat BELOW the client's refresh margin, so
-- the QR screen stopped refreshing itself and displayed a code until it died.
--
-- 20260728000000 reused any token with more than ONE MINUTE left. qr-editor.tsx
-- refreshes at REFRESH_MARGIN_MS = 90 seconds before expiry. Ninety seconds is
-- more than a minute, so the refresh call arrived while the token still
-- qualified for reuse and got the SAME token back:
--
--   T-90s  client calls mintQrToken()
--          server: 90s left > 60s floor -> returns the same token + expiry
--          client: setUrl(same), setExpiry(same) -> React bails out, no
--                  re-render, the effect never re-runs, no new timer is armed
--   T-0    the displayed code expires with nothing scheduled to replace it
--
-- Nothing looks wrong on the QR screen — it renders a perfectly good-looking
-- code. The failure only shows up on the other person's phone as "this code is
-- no longer active", which points the investigation at the scanner rather than
-- at the screen that is actually at fault.
--
-- The floor must exceed the client's margin so that a refresh always lands in
-- mint-fresh territory. Two minutes against a ninety-second margin leaves thirty
-- seconds of headroom. RAISING REFRESH_MARGIN_MS ABOVE TWO MINUTES REINTRODUCES
-- THIS — the constraint is now spelled out on both sides.
--
-- Only the floor changes. Everything else is carried over verbatim from
-- 20260728000000.
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

  -- Self-maintaining cleanup: each user sweeps their own expired rows on the
  -- way past, so the table stays bounded with no cron behind it. Vercel Hobby
  -- allows one cron a day (see WORKER_MODE in .env.example) and spending it on
  -- this would be a poor trade.
  delete from qr_tokens
   where profile_id = auth.uid()
     and expires_at < now() - interval '1 hour';

  -- MUST stay above qr-editor.tsx's REFRESH_MARGIN_MS. See the header.
  select token, expires_at into v_token, v_expires
    from qr_tokens
   where profile_id = auth.uid()
     and expires_at > now() + interval '2 minutes'
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

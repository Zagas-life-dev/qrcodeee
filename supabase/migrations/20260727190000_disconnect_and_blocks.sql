-- ============================================================================
-- §5.6 disconnect, plus the blocked-list read that makes blocking reversible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- disconnect_connection — soft delete, keeping the audit trail (§5.6)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because clients cannot write `connections` at all (§4) —
-- there is no UPDATE policy on that table by design.
--
-- Which means the membership predicate below IS the security model. RLS is not
-- filtering this statement, so without `user_a = auth.uid() or user_b =
-- auth.uid()` a caller-supplied connection id would let anyone sever any two
-- people's connection. §5.6 calls this obligation out explicitly, and it is the
-- same one connect_via_scan carries.
--
-- Returns a plain boolean and does NOT distinguish between "no such connection",
-- "not yours" and "already disconnected". Separating them would turn this into
-- an oracle for probing which connection ids exist and who is in them.
--
-- DELIBERATELY DOES NOT NOTIFY THE OTHER PERSON. §5.6 leaves this open; the
-- reasoning for the default:
--   * it is not actionable. Their saved phone contact is untouchable either way
--     — the browser cannot reach into an address book — so the only thing a
--     notification changes is that they now know.
--   * "X disconnected from you" invites conflict for no product benefit, in an
--     app whose entire premise is that connecting requires no approval and
--     therefore no negotiation.
--   * notifications.type is constrained to
--     ('major_change','accumulated_changes','new_connection'). There is no type
--     for this, so notifying would mean widening that CHECK — a deliberate
--     product decision, not something to slip in as a default.
-- Reversing this later is a migration plus a branch here, nothing structural.
create or replace function disconnect_connection(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update connections
     set disconnected_at = now()
   where id = p_connection_id
     and (user_a = auth.uid() or user_b = auth.uid())
     and disconnected_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function disconnect_connection(uuid) from public;
revoke all on function disconnect_connection(uuid) from anon;
grant execute on function disconnect_connection(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- list_blocked — without this, blocking is a one-way door
-- ---------------------------------------------------------------------------
-- The profiles SELECT policy is `using (not private.is_blocked(auth.uid(), id))`
-- and is_blocked checks BOTH directions. So once A blocks B, A can no longer
-- read B's profile either — which is correct for every other screen, and fatal
-- for the one screen that has to list who you blocked. Without this function the
-- block list renders a column of bare UUIDs and there is no way to work out whom
-- to unblock.
--
-- Safe as DEFINER specifically because it TAKES NO ARGUMENTS. The filter is
-- hardcoded to auth.uid(), so it can only ever return the caller's own block
-- list — facts the caller established themselves. A version taking a
-- blocker_id parameter would be an oracle for reading anyone's block list, which
-- is the exact mistake §4 warns about for the `private` helpers.
create or replace function list_blocked()
returns table (
  profile_id uuid,
  name text,
  photo_url text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.blocked_id, p.name, p.photo_url, b.created_at
    from blocks b
    join profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;

revoke all on function list_blocked() from public;
revoke all on function list_blocked() from anon;
grant execute on function list_blocked() to authenticated;

-- Blocking and unblocking themselves need no RPC: the §4 policy
-- `for all using (blocker_id = auth.uid())` already permits a client to insert
-- and delete its own rows, and there is nothing elevated to do. Reporting is
-- likewise a plain insert under the existing insert policy.

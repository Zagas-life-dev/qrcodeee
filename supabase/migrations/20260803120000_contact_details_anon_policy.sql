-- ============================================================================
-- Make the contact_details connections policy safe to evaluate as `anon`.
--
-- THE BUG: `private.has_active_connection` is granted to `authenticated` only —
-- deliberately, because §4 calls the inverse a social-graph oracle and anon has
-- no business asking it. But the policy that CALLS it is reachable logged out,
-- and a policy expression is evaluated with the caller's privileges. So an
-- anonymous select against contact_details did not return zero rows, it failed:
--
--   401  {"code":"42501","message":"permission denied for function has_active_connection"}
--
-- Nothing surfaced this until /u/{handle} (site-spec S3) gave anon a reason to
-- read the table. The Supabase client returns `{data: null, error}` rather than
-- throwing, so the public page rendered "Not provided" and looked correct — the
-- right output produced by an error instead of by a policy, which is the kind of
-- thing that keeps working right up until a caller checks `error`.
--
-- THE FIX is a CASE, not an AND. Postgres does not guarantee left-to-right
-- evaluation of AND, so `auth.uid() is not null and has_active_connection(...)`
-- may still call the function. CASE is one of the few constructs with a
-- guaranteed evaluation order, so the function is provably never reached without
-- a session.
--
-- Behaviour is unchanged for everyone else: has_active_connection(null, x) would
-- have returned false anyway, so this only replaces an error with the answer the
-- policy always intended.
--
-- The same shape is used for the connections-gated policy on site_blocks in the
-- next migration — that table is read by anon on every public profile page, so
-- it would have inherited this exact fault.
-- ============================================================================

drop policy if exists "connections can view contact details" on contact_details;

create policy "connections can view contact details"
  on contact_details for select
  using (
    case
      when auth.uid() is null then false
      else private.has_active_connection(auth.uid(), contact_details.profile_id)
    end
  );

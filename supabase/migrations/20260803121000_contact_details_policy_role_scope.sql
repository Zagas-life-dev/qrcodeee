-- ============================================================================
-- Scope the contact_details connections policy to `authenticated`.
--
-- Supersedes 20260803120000, which tried to solve this with a CASE guard and
-- DOES NOT WORK. Worth recording why, because the reasoning was plausible:
--
--   CASE has a guaranteed evaluation order in Postgres, so
--     case when auth.uid() is null then false else has_active_connection(...) end
--   provably never *evaluates* the function without a session. But EXECUTE on a
--   function is checked when the statement is PLANNED, not when the expression
--   is evaluated — the privilege check covers every function referenced in the
--   plan, including branches that will never run. So anon still got:
--
--     401 {"code":"42501","message":"permission denied for function has_active_connection"}
--
--   Verified against the live database, not reasoned about: the CASE version was
--   applied and the anonymous request failed identically.
--
-- THE FIX is to keep the function out of anon's plan entirely by scoping the
-- policy to the role it was always for. Postgres only applies a policy to the
-- roles named in `TO`, so for anon this policy no longer exists and its
-- expression is never planned.
--
-- Behaviour for authenticated callers is unchanged. For anon the result is what
-- the policy always intended: no rows, no error. The owner policy is untouched —
-- `profile_id = auth.uid()` references no function and is harmless to plan.
--
-- THE GENERAL RULE, since this will come up again: any RLS policy that calls a
-- `private.` helper anon cannot execute must be scoped `TO authenticated`.
-- `private.is_blocked` is the exception — §4 grants it to anon precisely because
-- logged-out reads depend on it.
-- ============================================================================

drop policy if exists "connections can view contact details" on contact_details;

create policy "connections can view contact details"
  on contact_details for select
  to authenticated
  using (private.has_active_connection(auth.uid(), contact_details.profile_id));

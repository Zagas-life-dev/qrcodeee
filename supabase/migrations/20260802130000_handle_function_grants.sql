-- ============================================================================
-- Close the anon EXECUTE grant on set_handle(), and make resolve_handle()'s
-- anon grant an explicit, deliberate exception.
--
-- 20260802120000 wrote `revoke all on function set_handle(text) from public`
-- and believed that was enough. It is not, for exactly the reason
-- 20260727160000 already documents: Supabase ships
--
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- which is an EXPLICIT per-role grant. Revoking from the PUBLIC pseudo-role
-- leaves it untouched, so set_handle shipped reachable as POST /rpc/set_handle
-- by anyone holding the anon key. scripts/verify-schema.mjs caught it on the
-- first run after the migration — which is the entire reason that assertion
-- exists, and it worked.
--
-- The blast radius was nil: set_handle reads auth.uid() first and returns
-- {"status":"unauthenticated"} without touching a row. That is not the reason to
-- fix it. The next definer function whose safety DOES depend on the caller
-- having a session would inherit the same silent default, and the failure mode
-- is a function that looks locked down in its own migration.
-- ============================================================================

revoke all on function public.set_handle(text) from anon;

-- resolve_handle stays anon-callable, and this line is the record of that being
-- a decision rather than an oversight. It IS the public profile page's read
-- (site-spec S3): /u/{handle} is reachable logged-out by design, so the function
-- behind it has to be. It is `stable`, takes one handle, returns only the three
-- fields the "profiles are publicly readable" policy already serves to anon, and
-- never enumerates — a caller who does not already know a handle learns nothing
-- from it.
grant execute on function public.resolve_handle(text) to anon, authenticated;

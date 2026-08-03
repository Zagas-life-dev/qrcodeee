-- ============================================================================
-- Take the site limit triggers off the API surface.
--
-- 20260803130000 revoked EXECUTE on these from `anon, authenticated` and that
-- was not enough, which scripts/verify-schema.mjs caught on the first run after
-- the migration. There are TWO grants to remove, not one, and they come from
-- different places:
--
--   1. Postgres itself grants EXECUTE on every new function to the PUBLIC
--      pseudo-role. Revoking from `anon` does nothing about it — anon still
--      holds the privilege through PUBLIC.
--   2. Supabase's default privileges additionally grant it to anon,
--      authenticated and service_role by name.
--
-- 20260727160100 already does both for the original trigger functions; these two
-- were added without following that pattern.
--
-- Blast radius was nil — a trigger function called directly over PostgREST has
-- no NEW/OLD record and errors immediately. That is not the reason to fix it:
-- every function created in `public` from here on inherits the same two grants,
-- and the next one may not be inert.
-- ============================================================================

revoke all on function public.enforce_site_section_limit() from public;
revoke all on function public.enforce_site_block_limit() from public;
revoke all on function public.enforce_site_section_limit() from anon, authenticated;
revoke all on function public.enforce_site_block_limit() from anon, authenticated;

-- ============================================================================
-- Finish what 20260727160000 started.
--
-- That migration revoked the trigger functions from `anon, authenticated` but
-- not from PUBLIC, and CREATE FUNCTION grants EXECUTE to PUBLIC by default. So
-- has_function_privilege('anon', ...) still answered true — anon inherits it
-- through PUBLIC. Both revokes are needed; neither alone is sufficient:
--
--   revoke ... from public          -> leaves Supabase's explicit per-role grants
--   revoke ... from anon, authenticated -> leaves the CREATE FUNCTION default
--
-- Safety note on doing this to TRIGGER functions specifically: PostgreSQL checks
-- EXECUTE on a trigger function at CREATE TRIGGER time, not each time the
-- trigger fires. Revoking here therefore removes the function from the API
-- surface without affecting the triggers themselves — which the verification
-- suite confirms, since it exercises signup, profile edits, contact edits and
-- custom-field writes, and all four depend on these firing.
-- ============================================================================

revoke all on function public.set_updated_at() from public;
revoke all on function public.bump_profile_version() from public;
revoke all on function public.log_profile_change_event() from public;
revoke all on function public.log_contact_details_change_event() from public;
revoke all on function public.log_custom_field_change_event() from public;
revoke all on function public.enforce_custom_field_limit() from public;
revoke all on function public.handle_new_user() from public;

-- Deliberately NOT touched: public.rls_auto_enable(). It is Supabase's own
-- event-trigger helper (backing the `ensure_rls` event trigger, which enables
-- RLS automatically on any table created in `public`) and is platform-managed,
-- not ours. It returns `event_trigger`, a type PostgREST cannot expose over
-- HTTP, so the anon grant on it is not reachable API surface.

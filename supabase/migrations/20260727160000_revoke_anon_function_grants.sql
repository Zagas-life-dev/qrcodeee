-- ============================================================================
-- Close the anon EXECUTE grant on every function we own in `public`.
--
-- `revoke all on function ... from public` is NOT sufficient on Supabase, which
-- is a genuinely easy thing to get wrong because the revoke appears to work.
-- Supabase ships:
--
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- Those are EXPLICIT per-role grants. Revoking from the PUBLIC pseudo-role does
-- nothing to them, so every function created in `public` is reachable as
-- POST /rpc/<name> by an anonymous caller holding only the anon key.
--
-- Verified before this migration:
--   connect_via_scan(text)         anon=YES
--   rotate_qr_token()              anon=YES
--   reorder_custom_fields(uuid[])  anon=YES
--
-- Today's blast radius is small — all three derive identity from auth.uid() and
-- no-op or raise without a session. That is not the reason to fix it. The
-- default applies to every function added from here on, including ones whose
-- safety depends on the caller being authenticated, and the failure is silent.
-- scripts/verify-schema.mjs now asserts this so a new function can't quietly
-- reintroduce it.
--
-- Note the helpers in `private` were never affected: the default privileges
-- above are scoped to schema `public`, which is one more reason those live where
-- they do (§4).
-- ============================================================================

-- Client-callable RPCs: authenticated only.
revoke all on function public.connect_via_scan(text) from anon;
revoke all on function public.rotate_qr_token() from anon;
revoke all on function public.reorder_custom_fields(uuid[]) from anon;

-- Trigger functions. No client role has any business invoking these directly —
-- outside a trigger they have no NEW/OLD and simply error — but they are
-- published as RPC endpoints all the same, so take them off the API surface.
revoke all on function public.set_updated_at() from anon, authenticated;
revoke all on function public.bump_profile_version() from anon, authenticated;
revoke all on function public.log_profile_change_event() from anon, authenticated;
revoke all on function public.log_contact_details_change_event() from anon, authenticated;
revoke all on function public.log_custom_field_change_event() from anon, authenticated;
revoke all on function public.enforce_custom_field_limit() from anon, authenticated;
revoke all on function public.handle_new_user() from anon, authenticated;

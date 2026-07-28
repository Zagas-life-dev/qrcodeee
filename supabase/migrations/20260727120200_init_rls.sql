-- ============================================================================
-- QR Connect — policy helpers, RLS, column grants, realtime (§4)
--
-- THE TRAP THAT MAKES BIDIRECTIONAL BLOCKING SILENTLY ONE-DIRECTIONAL:
-- a policy expression that reads another table is *itself* subject to that
-- table's RLS. `blocks` only exposes rows where blocker_id = auth.uid() (you
-- can't enumerate who blocked you — correct, and worth keeping). So an inline
--   select 1 from blocks
--    where ... or (blocker_id = profiles.id and blocked_id = auth.uid())
-- can NEVER match its second half: the rows proving "they blocked me" are
-- invisible to me inside my own policy check. The policy still compiles, still
-- passes a casual test where you block someone and confirm they vanish, and
-- quietly does nothing in the direction that actually matters — the person who
-- GOT blocked keeps full visibility. Every block check therefore goes through
-- the SECURITY DEFINER helpers below, which see the whole table.
--
-- WHY THE HELPERS LIVE IN `private`, NOT `public`: they are SECURITY DEFINER, so
-- they read past RLS by design — and PostgREST publishes every function in an
-- exposed schema as POST /rpc/<name>, EXECUTE granted to PUBLIC by default. In
-- `public` they would be callable with ARBITRARY arguments by any authenticated
-- user: /rpc/is_blocked answering "have these two people blocked each other" for
-- any pair, /rpc/has_active_connection enumerating the private social graph one
-- pair at a time. Each would hand out precisely the fact its own policy exists
-- to withhold. Revoking EXECUTE isn't the fix — policy evaluation runs as the
-- querying user and needs it. An unexposed schema is.
--
--   >>> ACTION REQUIRED IN THE DASHBOARD: Settings -> API -> Exposed schemas
--   >>> must list `public` (and `graphql_public`) but NOT `private`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------
-- STABLE so Postgres can cache per-statement rather than re-running per row.
create or replace function private.is_blocked(a uuid, b uuid) returns boolean as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$ language sql stable security definer set search_path = public, pg_temp;

create or replace function private.has_active_connection(a uuid, b uuid) returns boolean as $$
  select exists (
    select 1 from connections
    where disconnected_at is null
      and ((user_a = a and user_b = b) or (user_a = b and user_b = a))
  ) and not private.is_blocked(a, b);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Directional variant, used only by connect_via_scan (§5.1) to decide whether it
-- can safely say "blocked" or has to fall back to a cover story.
create or replace function private.has_blocked(blocker uuid, target uuid) returns boolean as $$
  select exists (
    select 1 from blocks where blocker_id = blocker and blocked_id = target
  );
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function private.is_blocked(uuid, uuid) from public;
revoke all on function private.has_active_connection(uuid, uuid) from public;
revoke all on function private.has_blocked(uuid, uuid) from public;

-- anon needs is_blocked: the profiles and public-custom_fields SELECT policies
-- are reachable logged-out (§6 landing page) and call it.
grant execute on function private.is_blocked(uuid, uuid) to authenticated, anon;
grant execute on function private.has_active_connection(uuid, uuid) to authenticated;
-- service_role: the change-notification worker (§5.4) filters its fan-out query
-- with is_blocked() while connected as service_role.
grant execute on function private.is_blocked(uuid, uuid) to service_role;
-- has_blocked stays definer-only — no client role needs it. connect_via_scan
-- can still call it because that function is SECURITY DEFINER owned by postgres.


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

-- Note there is NO `deleted_at is null` clause here, which is a change from the
-- obvious version — see §8. Filtering deleted profiles out at the policy level
-- also makes them unreadable to connection-history joins, which is precisely
-- what destroys the "Deleted account" placeholder that policy is built around:
-- the connection row resolves to no profile row at all. Instead, soft-delete
-- SCRUBS the row (§8) so what stays readable holds nothing private, and the
-- frontend renders the placeholder off `deleted_at is not null`.
--   >>> Any search/discovery query, and connect_via_scan, must then filter
--   >>> `deleted_at is null` ITSELF. That filter moves to the query layer, it
--   >>> does not disappear.
create policy "profiles are publicly readable"
  on profiles for select using (not private.is_blocked(auth.uid(), id));
create policy "users can update their own profile"
  on profiles for update using (auth.uid() = id);

-- RLS decides which ROWS a user may touch and says nothing about which COLUMNS.
-- On its own, the update policy above also lets a client set its own
-- profile_version to 999999 (poisoning the notification watermark on every one
-- of its connections), clear its own deleted_at to undo an account deletion, or
-- overwrite qr_token with a chosen value. Column grants are the missing half and
-- compose with RLS.
revoke update on profiles from anon, authenticated;
grant update (name, photo_url, bio, qr_style) on profiles to authenticated;
-- qr_token rotation and account deletion go through their own SECURITY DEFINER
-- RPCs; profile_version is trigger-maintained only.

-- No insert policy on profiles at all — rows come from handle_new_user().


-- ---------------------------------------------------------------------------
-- contact_details
-- ---------------------------------------------------------------------------
alter table contact_details enable row level security;
create policy "owner manages their own contact details"
  on contact_details for all using (profile_id = auth.uid());
create policy "connections can view contact details"
  on contact_details for select
  using (private.has_active_connection(auth.uid(), contact_details.profile_id));
-- Postgres ORs multiple permissive SELECT policies together, so a user gets
-- their own contact_details row (owner policy) plus anyone they're actively
-- connected to (connections policy) — nothing else.
--
-- Using the helper rather than an inline `select 1 from connections` matters
-- twice over: that subquery would be filtered by the connections SELECT policy,
-- making this policy's correctness depend on another policy's exact shape, and
-- the inline version carried no block check of its own — so a blocked pair with
-- a still-existing connection row kept reading each other's phone and email for
-- as long as the connections policy's own broken block check let the row through.


-- ---------------------------------------------------------------------------
-- custom_fields
-- ---------------------------------------------------------------------------
alter table custom_fields enable row level security;
create policy "public custom fields readable by anyone, private only by owner"
  on custom_fields for select
  using (
    profile_id = auth.uid()
    or (is_public = true and not private.is_blocked(auth.uid(), profile_id))
  );
create policy "owner manages their own custom fields"
  on custom_fields for all using (profile_id = auth.uid());


-- ---------------------------------------------------------------------------
-- connections
-- ---------------------------------------------------------------------------
alter table connections enable row level security;
create policy "users see their own active, unblocked connections"
  on connections for select
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and disconnected_at is null
    and not private.is_blocked(user_a, user_b)
  );
-- Inserts/updates only via the connect_via_scan / disconnect functions (§5.1,
-- §5.6) — no direct client writes to this table, and no policies granting them.


-- ---------------------------------------------------------------------------
-- blocks / reports
-- ---------------------------------------------------------------------------
alter table blocks enable row level security;
create policy "users manage their own block list"
  on blocks for all using (blocker_id = auth.uid());

alter table reports enable row level security;
create policy "users can only see reports they filed"
  on reports for select using (reporter_id = auth.uid());
create policy "users can file reports"
  on reports for insert with check (reporter_id = auth.uid());
-- No update policy: resolved_at is service-role only (§5.6).


-- ---------------------------------------------------------------------------
-- profile_change_events
-- ---------------------------------------------------------------------------
alter table profile_change_events enable row level security;
-- No client access at all — written by trigger, read only by the background
-- worker via the service role; no policies grant access to the authenticated
-- role. This is exactly why the three change-event trigger functions must be
-- SECURITY DEFINER: RLS-with-no-policies denies the trigger's own insert when
-- the function runs as the calling user, which surfaces as every profile edit
-- failing.


-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
alter table notifications enable row level security;
create policy "recipient reads and marks their own notifications"
  on notifications for select using (recipient_id = auth.uid());
create policy "recipient can mark their own notifications read"
  on notifications for update using (recipient_id = auth.uid());
-- No insert policy: rows come from the background worker via the service role
-- (change notifications) and from connect_via_scan, which is SECURITY DEFINER
-- and so writes past RLS (new_connection — §5.1). Never a direct client insert.
revoke update on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;
-- Same column-scope issue as profiles: "mark their own notifications read"
-- otherwise lets a recipient rewrite type/source_profile_id/change_version on
-- any row they receive.


-- ---------------------------------------------------------------------------
-- Realtime (§5.2, §5.5)
-- ---------------------------------------------------------------------------
-- Not automatic — a table has to be in the publication or subscriptions
-- silently receive nothing, with no error to debug. Realtime still applies each
-- subscriber's RLS on top of this, so publishing these two exposes nothing the
-- policies above don't already allow.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connections'
    ) then
      alter publication supabase_realtime add table connections;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table notifications;
    end if;
  end if;
end $$;

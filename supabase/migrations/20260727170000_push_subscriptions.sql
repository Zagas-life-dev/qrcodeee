-- ============================================================================
-- Web Push subscriptions (§5.2 step 3).
--
-- Not in the build spec's §3 schema, but required by it: "If their app is
-- closed: a Web Push notification is the only way to reach them." Web Push needs
-- the endpoint plus the p256dh and auth keys stored per device, and there was
-- nowhere to put them.
--
-- One row per BROWSER INSTALL, not per user — a person with a phone and a laptop
-- has two, and both must receive.
-- ============================================================================

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- The push service URL. Unique globally, not per profile: it identifies one
  -- browser install, so if someone signs out and a different account signs in on
  -- the same device, that endpoint must MOVE rather than duplicate — otherwise
  -- the previous user keeps receiving that device's notifications. Registration
  -- upserts on this column and overwrites profile_id.
  endpoint text not null check (char_length(endpoint) <= 2048),
  -- Encryption material from the browser's PushSubscription (base64url).
  p256dh text not null check (char_length(p256dh) <= 255),
  auth text not null check (char_length(auth) <= 255),
  user_agent text check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  -- Bumped on each successful send; lets a retention job reap installs that
  -- stopped responding without waiting for a 404/410 from the push service.
  last_used_at timestamptz
);

create unique index push_subscriptions_endpoint_key on push_subscriptions (endpoint);
-- The send path's only query: every live subscription for one recipient.
create index push_subscriptions_profile_idx on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;

-- Owner-only, in both directions. There is no read path for anyone else: these
-- rows are effectively device identifiers, and the sender reads them with the
-- service role.
create policy "owner manages their own push subscriptions"
  on push_subscriptions for all using (profile_id = auth.uid());

-- Deliberately NOT added to supabase_realtime. Nothing subscribes to this, and
-- publishing it would stream device identifiers over websockets for no reason.

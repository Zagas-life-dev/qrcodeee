-- ============================================================================
-- Constrain profiles.photo_url to hosts we actually control.
--
-- photo_url is in the §4 column grant, so it is directly client-writable — a
-- scripted client can PATCH it to any string that fits in 2048 characters. That
-- string is then rendered as an <img src> on a profile page that, by design, is
-- publicly readable and shown to every connection. Unconstrained, it hands any
-- user a beacon: point photo_url at a server you control and you learn the IP,
-- user-agent and timing of everyone who views your profile, and you can serve
-- different bytes to different viewers. It's also an unbounded-payload vector,
-- since nothing else caps what sits behind that URL.
--
-- Two hosts are legitimate:
--   * our Cloudinary cloud, where uploads land (§2)
--   * googleusercontent.com, because handle_new_user() seeds photo_url from the
--     Google OAuth avatar_url so new accounts aren't blank. Subdomain is
--     wildcarded (lh3/lh4/lh5/...); the host suffix is anchored so
--     `googleusercontent.com.evil.test` cannot match.
--
-- The cloud name is pinned rather than accepting any Cloudinary account —
-- res.cloudinary.com/<attacker-cloud>/ is as attacker-controlled as any other
-- origin. Changing Cloudinary accounts needs a migration; that's the intent.
--
-- This is a host allowlist, not a claim the bytes are safe. It stops the
-- redirect/beacon class of problem, not "the user uploaded something unpleasant"
-- — that's moderation (§5.6).
-- ============================================================================

alter table profiles add constraint photo_url_allowed_host check (
  photo_url is null
  or photo_url ~ '^https://res\.cloudinary\.com/djm0gwdv/image/upload/'
  or photo_url ~ '^https://([a-z0-9-]+\.)*googleusercontent\.com/'
);

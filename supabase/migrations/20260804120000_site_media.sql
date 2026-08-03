-- ============================================================================
-- Site media: version column and a hard cap (site-spec S6).
--
-- `site_media` shipped in 20260803130000 as a ledger with no way to build a URL
-- from a row: Cloudinary delivery URLs need the asset VERSION, and without it a
-- stored public_id can only be resolved by asking Cloudinary. The version is
-- also what makes a re-upload safe — same public_id, new version, so a CDN copy
-- of the old bytes cannot survive a replacement.
--
-- WHY `bigint`: Cloudinary versions are Unix seconds today, but they are
-- documented as an opaque integer. `int` would work until 2038 and then stop,
-- which is exactly the kind of bet this schema should not be making.
-- ============================================================================

alter table site_media add column if not exists version bigint not null default 1;

-- `alt` deliberately does NOT live here. Alt text describes an image IN CONTEXT
-- — the same photo is "me at the studio" in one block and "the studio" in
-- another — so it belongs to the block that places it, not to the asset. See
-- ImageRef in src/lib/site/blocks.ts.


-- ---------------------------------------------------------------------------
-- Hard cap
-- ---------------------------------------------------------------------------
-- Same reasoning as the section and block caps: not a tier limit, just the
-- ceiling that stops one account using our Cloudinary account as free storage.
-- 300 images is far past any plausible personal page and well under anything
-- that costs real money.
create or replace function enforce_site_media_limit() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from site_media where profile_id = new.profile_id) >= 300 then
    raise exception 'media limit reached' using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger site_media_limit
  before insert on site_media
  for each row execute function enforce_site_media_limit();

-- Both revokes are needed and neither implies the other: CREATE FUNCTION grants
-- EXECUTE to PUBLIC, and Supabase grants it explicitly to `anon`/`authenticated`
-- on top. Revoking one leaves the other in place — the bug fixed in
-- 20260803140000, repeated here because the shape repeats.
revoke all on function enforce_site_media_limit() from public;
revoke all on function enforce_site_media_limit() from anon, authenticated;

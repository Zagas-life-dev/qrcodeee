-- ============================================================================
-- Sites, sections and blocks (site-spec S4 / S8).
--
-- The personal page behind /u/{handle}: an ordered list of SECTIONS, each
-- holding BLOCKS, with `bento` sections arranging theirs through a recursive
-- split tree stored as JSONB.
--
-- WHAT DELIBERATELY DOES NOT HAPPEN HERE: no change-event trigger, on any of
-- these tables. §5.4's triggers stay pointed at profiles, contact_details and
-- custom_fields. Someone rearranging their layout at midnight must not fan out
-- "they updated their profile" to 400 connections, and the cheapest way to
-- guarantee that is for these tables to have no trigger to misfire (S2).
--
-- NOTE ON POLICY ROLES: every policy below that calls
-- `private.has_active_connection` is scoped `TO authenticated`. That is not
-- tidiness — anon cannot EXECUTE that function, and Postgres checks function
-- privileges when a statement is PLANNED, so an unscoped policy makes every
-- anonymous read of the table fail with 42501 rather than return no rows. See
-- 20260803121000, which is that exact bug found on contact_details.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
-- A separate table rather than columns on `profiles`, which is read on every
-- connection render and every vCard build and needs none of this.
create table sites (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- Off until the owner says otherwise. An unpublished site does not hide the
  -- profile — /u/{handle} still renders the contact card — it only withholds the
  -- custom sections, so the page works from the moment a handle exists and the
  -- blocks are strictly additive.
  published boolean not null default false,
  template_id text check (template_id is null or char_length(template_id) <= 64),
  theme jsonb not null default '{}'::jsonb check (pg_column_size(theme) <= 2048),
  seo   jsonb not null default '{}'::jsonb check (pg_column_size(seo)   <= 2048),
  -- Distinct from profiles.updated_at: this one drives cache invalidation
  -- (S12's `site:` tag), not change notifications.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create trigger sites_set_updated_at
  before update on sites
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- site_sections
-- ---------------------------------------------------------------------------
create type section_layout as enum ('bento', 'row-scroll', 'stack-scroll', 'single');

create table site_sections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(profile_id) on delete cascade,
  layout_type section_layout not null default 'single',
  /**
   * The Cell tree (S4), or null for the three non-bento layouts, which order
   * their blocks by the blocks' own sort_order.
   *
   * A JSONB blob cannot carry the CHECK constraints the old `smallint` spans
   * could, so the real invariants — depth <= 4, ratio in [0.2, 0.8], leaf set
   * equal to the section's block set — are enforced in the write path and
   * guarded again at render. What the database can cheaply insist on is that
   * this is an object at all, and that it is small: depth 4 means at most 16
   * leaves, which cannot legitimately produce a large document.
   */
  root_cell jsonb
    check (root_cell is null or jsonb_typeof(root_cell) = 'object')
    check (root_cell is null or pg_column_size(root_cell) <= 8192),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index site_sections_site_order_idx on site_sections (site_id, sort_order);

create trigger site_sections_set_updated_at
  before update on site_sections
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- site_blocks
-- ---------------------------------------------------------------------------
create type block_visibility as enum ('public', 'connections', 'private');

create table site_blocks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references site_sections(id) on delete cascade,
  -- Not an enum: the block catalogue (S5) will grow, and an enum makes each
  -- addition a migration that has to run before any deploy that renders the new
  -- type. Unknown types render as nothing (see the renderer), so a text column
  -- degrades safely in the direction a rollback needs.
  type text not null check (char_length(type) between 1 and 40),
  content jsonb not null default '{}'::jsonb
    check (jsonb_typeof(content) = 'object')
    check (pg_column_size(content) <= 16384),
  -- Ordering WITHIN a section for the non-bento layouts, and the degraded
  -- render order for a bento section whose tree fails validation.
  sort_order int not null default 0,
  visibility block_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index site_blocks_section_order_idx on site_blocks (section_id, sort_order);

create trigger site_blocks_set_updated_at
  before update on site_blocks
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- site_media
-- ---------------------------------------------------------------------------
-- Exists so uploads can be quota-counted and orphans swept by the §8 retention
-- job. A Cloudinary public_id buried inside a block's `content` blob is not
-- something a cleanup query can find.
create table site_media (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  public_id text not null check (char_length(public_id) <= 255),
  width int, height int, bytes int,
  created_at timestamptz not null default now()
);

create index site_media_profile_idx on site_media (profile_id);


-- ---------------------------------------------------------------------------
-- Hard caps
-- ---------------------------------------------------------------------------
-- NOT tier limits — those are deferred and unenforced (S13). These are the
-- ceiling that stops one account turning its own page into a denial of service
-- against our renderer, and they apply to everybody including a paid tier that
-- does not exist yet. Set far above any plausible real page.
create or replace function enforce_site_section_limit() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from site_sections where site_id = new.site_id) >= 30 then
    raise exception 'section limit reached' using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger site_sections_limit
  before insert on site_sections
  for each row execute function enforce_site_section_limit();

create or replace function enforce_site_block_limit() returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  select site_id into owner from site_sections where id = new.section_id;
  if (
    select count(*)
      from site_blocks b
      join site_sections s on s.id = b.section_id
     where s.site_id = owner
  ) >= 200 then
    raise exception 'block limit reached' using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger site_blocks_limit
  before insert on site_blocks
  for each row execute function enforce_site_block_limit();

revoke all on function enforce_site_section_limit() from anon, authenticated;
revoke all on function enforce_site_block_limit() from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Tier columns — shaped now, read by nothing (S13)
-- ---------------------------------------------------------------------------
alter table profiles add column tier text not null default 'free'
  check (tier in ('free', 'trial', 'paid'));

-- Limits are per-TIER, not per-user, so they belong in a lookup rather than
-- replicated across every profile row. Turning gating on later is then an UPDATE
-- here plus a read in the write paths, not a migration over live data.
create table tier_limits (
  tier text primary key,
  max_sections int,
  max_blocks int,
  media_allowed boolean not null default true,
  email_list_allowed boolean not null default true,
  analytics_level text not null default 'full'
);

insert into tier_limits (tier, max_sections, max_blocks, media_allowed, email_list_allowed, analytics_level) values
  ('free',  3,  5,  false, false, 'views'),
  ('trial', 8,  12, true,  false, 'sources'),
  ('paid',  30, 200, true, true,  'full')
on conflict do nothing;

-- Comps, grandfathering, and anyone who needs to be an exception to their tier.
alter table profiles add column limit_overrides jsonb
  check (limit_overrides is null or jsonb_typeof(limit_overrides) = 'object');

alter table tier_limits enable row level security;
-- RLS on, zero policies. Nothing client-side reads this yet, and when gating
-- ships the check belongs in the write path, not in the browser.


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table sites enable row level security;

-- `private.is_blocked` is safe in a policy anon evaluates: §4 grants EXECUTE on
-- it to anon precisely because logged-out profile reads depend on it.
create policy "published sites are publicly readable"
  on sites for select
  using (published and not private.is_blocked(auth.uid(), profile_id));

create policy "owner manages their own site"
  on sites for all
  to authenticated
  using (profile_id = auth.uid());


alter table site_sections enable row level security;

-- The subquery is itself filtered by the sites policies above, so "published"
-- and "not blocked" are both inherited rather than restated. Restating them
-- would be a second copy to keep in sync with the first.
create policy "sections of published sites are publicly readable"
  on site_sections for select
  using (exists (select 1 from sites s where s.profile_id = site_sections.site_id));

create policy "owner manages their own sections"
  on site_sections for all
  to authenticated
  using (site_id = auth.uid());


alter table site_blocks enable row level security;

-- Likewise inherits publication and block state through site_sections.
create policy "public blocks are publicly readable"
  on site_blocks for select
  using (
    visibility = 'public'
    and exists (select 1 from site_sections sec where sec.id = site_blocks.section_id)
  );

-- TO authenticated: see the header note. Unscoped, this makes every anonymous
-- read of site_blocks — which is every public profile page view — fail.
create policy "connections can read connection-gated blocks"
  on site_blocks for select
  to authenticated
  using (
    visibility = 'connections'
    and exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and private.has_active_connection(auth.uid(), sec.site_id)
    )
  );

-- Owner sees everything of their own, including `private` drafts.
create policy "owner manages their own blocks"
  on site_blocks for all
  to authenticated
  using (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
    )
  );


alter table site_media enable row level security;
-- Owner-only, and nothing public reads it: a block references Cloudinary by
-- public_id inside its content, and the URL is built from that. This table is
-- bookkeeping for quotas and orphan sweeps.
create policy "owner manages their own media"
  on site_media for all
  to authenticated
  using (profile_id = auth.uid());


-- ---------------------------------------------------------------------------
-- Signup + backfill
-- ---------------------------------------------------------------------------
-- Replaces 20260802120000's version. Only the sites row is new.
create or replace function handle_new_user() returns trigger as $$
declare
  display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'New user');

  insert into profiles (id, name, photo_url, handle)
  values (
    new.id,
    display_name,
    new.raw_user_meta_data->>'avatar_url',
    private.generate_handle(display_name)
  );
  insert into contact_details (profile_id) values (new.id);
  -- Unpublished, empty. Created at signup rather than lazily so every read path
  -- can assume the row exists — a page that has to cope with "no site yet" grows
  -- a null branch in every query that touches it.
  insert into sites (profile_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

insert into sites (profile_id)
select id from profiles
on conflict (profile_id) do nothing;

-- ============================================================================
-- The permanent identity section (site-spec S3 / S4).
--
-- WHAT CHANGES, AND WHY IT IS A SCHEMA CHANGE RATHER THAN A RENDER ONE.
--
-- /u/{handle} used to open with a hardcoded, app-styled contact card: the
-- react-bits ProfileCard plus a details panel, drawn by the page itself and
-- identical on every site in the product. Everything the owner actually built
-- appeared underneath it. So the one element every visitor saw first was the one
-- element the owner had no say over, and their page began below the fold.
--
-- That card is gone. In its place is a real block, in a real section, in the
-- owner's own site — skinned by their theme, styled by the same controls as
-- everything else, and editable from /site like any other block. The only thing
-- that makes it different is that it cannot be removed:
--
--   * `pinned` marks the section, one per site, enforced by a partial unique
--     index rather than by convention.
--   * It sorts at -1, so it is first without anybody having to remember to put
--     it there, and `addSection`'s `max(sort_order) + 1` still starts at 0.
--   * The owner's RLS policies are split by command so that DELETE excludes it.
--     Referential-integrity cascades bypass RLS, so account deletion still
--     removes it — which a BEFORE DELETE trigger would have broken.
--
-- PUBLICATION MOVES OFF `sites` AND ONTO `site_sections`. The identity block has
-- to render whether or not the page is published, because it is now the only
-- thing carrying the person's name and photo — an unpublished page would
-- otherwise be blank. So the `sites` row itself becomes publicly readable and
-- the published check moves to the sections policy, where it can make an
-- exception for the pinned one.
--
-- THE EXPOSURE THAT BUYS, STATED PLAINLY: `theme`, `template_id`, `seo` and the
-- `published` flag of an UNPUBLISHED site become readable by anyone who knows
-- the profile id. RLS is row-level, so there is no way to publish one column of
-- a row and not another. None of those describe the person — they describe the
-- page's styling — and the alternative was a second query path reading the
-- pinned section with no theme to render it under.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------
alter table site_sections
  add column pinned boolean not null default false;

-- One per site, and the database is what says so. The write path never inserts
-- a second (the INSERT policy below forbids `pinned` outright), but the
-- backfill and the signup trigger both create one, and a partial unique index
-- is what makes running either of them twice safe.
create unique index site_sections_one_pinned_idx
  on site_sections (site_id) where pinned;


-- ---------------------------------------------------------------------------
-- Creating one
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the INSERT policies below deliberately refuse a
-- pinned section and refuse blocks inside one — this is the only thing allowed
-- to make them, and it is not reachable from the client (see the revoke).
--
-- Idempotent by check rather than by `on conflict`: the section and the block
-- are two inserts, and a conflict on the first would leave the second pointing
-- at nothing.
create or replace function private.create_identity_section(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_section uuid;
begin
  if exists (select 1 from site_sections where site_id = p_profile and pinned) then
    return;
  end if;

  insert into site_sections (site_id, layout_type, sort_order, pinned)
  values (p_profile, 'single', -1, true)
  returning id into new_section;

  -- `tagline` is the only thing the block stores; name, photo, bio and handle
  -- are read from the profile at render time. See identity-block.tsx for why
  -- copying them in would be a bug rather than a shortcut.
  insert into site_blocks (section_id, type, content, sort_order, visibility)
  values (new_section, 'identity', jsonb_build_object('tagline', null), 0, 'public');
end;
$$;

revoke all on function private.create_identity_section(uuid) from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Signup + backfill
-- ---------------------------------------------------------------------------
-- Replaces 20260803130000's version. Only the identity call is new.
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
  -- Unpublished, but no longer empty: every site starts with the one section it
  -- can never lose, so no read path has to cope with a page that has no
  -- identity on it.
  insert into sites (profile_id) values (new.id);
  perform private.create_identity_section(new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

select private.create_identity_section(profile_id) from sites;


-- ---------------------------------------------------------------------------
-- Publication moves to the sections policy
-- ---------------------------------------------------------------------------
drop policy "published sites are publicly readable" on sites;

-- Still blocked-aware; no longer publication-aware. What `published` now gates
-- is which SECTIONS are visible, which is where the distinction actually lives.
create policy "sites are publicly readable"
  on sites for select
  using (not private.is_blocked(auth.uid(), profile_id));

drop policy "sections of published sites are publicly readable" on site_sections;

-- The subquery is itself filtered by the sites policy above, so "not blocked" is
-- inherited rather than restated. `pinned` is the exception that lets an
-- unpublished page still say whose it is.
create policy "sections of published sites are publicly readable"
  on site_sections for select
  using (
    exists (
      select 1 from sites s
       where s.profile_id = site_sections.site_id
         and (s.published or site_sections.pinned)
    )
  );


-- ---------------------------------------------------------------------------
-- The owner's policies, split by command
-- ---------------------------------------------------------------------------
-- `FOR ALL` cannot express "everything except deleting this one row", so each
-- command gets its own policy. SELECT and UPDATE are unchanged in effect —
-- the owner still reads and edits every row of their own site, the identity
-- block included, which is what makes its tagline and styling editable.
drop policy "owner manages their own sections" on site_sections;

create policy "owner reads their own sections"
  on site_sections for select
  to authenticated
  using (site_id = auth.uid());

-- `not pinned`: a second pinned section is not a thing the client may create.
-- The unique index would catch it anyway; this refuses it a step earlier and
-- says so in the schema rather than in an error code.
create policy "owner adds sections to their own site"
  on site_sections for insert
  to authenticated
  with check (site_id = auth.uid() and not pinned);

create policy "owner updates their own sections"
  on site_sections for update
  to authenticated
  using (site_id = auth.uid())
  with check (site_id = auth.uid());

create policy "owner deletes their own unpinned sections"
  on site_sections for delete
  to authenticated
  using (site_id = auth.uid() and not pinned);


drop policy "owner manages their own blocks" on site_blocks;

create policy "owner reads their own blocks"
  on site_blocks for select
  to authenticated
  using (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
    )
  );

-- The pinned section holds exactly one block and always will: it is the
-- identity, not a container the owner fills.
create policy "owner adds blocks to their own unpinned sections"
  on site_blocks for insert
  to authenticated
  with check (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
         and not sec.pinned
    )
  );

-- No `pinned` exclusion, deliberately: this is the policy that lets someone
-- write their own tagline and restyle their identity card.
create policy "owner updates their own blocks"
  on site_blocks for update
  to authenticated
  using (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
    )
  );

create policy "owner deletes blocks from their own unpinned sections"
  on site_blocks for delete
  to authenticated
  using (
    exists (
      select 1 from site_sections sec
       where sec.id = site_blocks.section_id
         and sec.site_id = auth.uid()
         and not sec.pinned
    )
  );

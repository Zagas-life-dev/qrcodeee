-- ============================================================================
-- §11 step 8: connection history search + pagination tuning.
--
-- SECURITY INVOKER, and that is the whole design. Running as the caller means
-- the `connections` SELECT policy (own, active, unblocked) and the `profiles`
-- policy (not blocked) both still apply, so this function contains no
-- authorization logic of its own and cannot drift from the policies. A DEFINER
-- version would have to re-implement both by hand and would silently become
-- "search everyone's connections" the day someone got a predicate wrong.
--
-- Replaces the previous two-query approach on the connections page. That one
-- fetched a page of connection rows and then a second batch of profiles — which
-- cannot support search, because the name being searched lives in the second
-- query and the pagination happens in the first.
-- ============================================================================

create or replace function search_connections(
  p_query text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  connection_id uuid,
  profile_id uuid,
  name text,
  photo_url text,
  deleted_at timestamptz,
  connected_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select c.id, c.connected_at,
           case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id
      from connections c
  ),
  joined as (
    select m.id, m.connected_at, p.id as pid, p.name, p.photo_url, p.deleted_at
      from mine m
      join profiles p on p.id = m.other_id
     where p_query is null
        or btrim(p_query) = ''
        -- % and _ are ILIKE wildcards, so a user searching for "50%" would
        -- otherwise match everything. Escaped, with the backslash escaped first
        -- so it can't double-escape the escapes.
        or p.name ilike '%' || replace(replace(replace(
             btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  )
  select j.id, j.pid, j.name, j.photo_url, j.deleted_at, j.connected_at,
         -- Window function rather than a second count query: one round trip, and
         -- the count is guaranteed consistent with the page being returned.
         count(*) over () as total_count
    from joined j
   order by j.connected_at desc, j.id
   limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

revoke all on function search_connections(text, int, int) from public;
revoke all on function search_connections(text, int, int) from anon;
grant execute on function search_connections(text, int, int) to authenticated;

-- ============================================================================
-- Reorder a profile's custom fields in one statement.
--
-- Without this, reordering is N round trips that can half-apply: a failure after
-- row 7 of 20 leaves the list in an order the user never chose, and there's no
-- transaction spanning them to roll back. One statement is also one lock
-- acquisition instead of twenty.
--
-- SECURITY INVOKER (the default) is deliberate and load-bearing. This function
-- needs no elevated access — the §4 policy `for all using (profile_id =
-- auth.uid())` already scopes custom_fields to the owner, and running as the
-- caller means that policy still applies. A SECURITY DEFINER version would
-- silently become "reorder anyone's fields" and would need to re-implement the
-- ownership check by hand. The explicit `profile_id = auth.uid()` filter below
-- is belt-and-braces, not the primary control.
--
-- Note this only writes sort_order. Per §5.4 that is exactly what keeps
-- reordering free: the custom_fields UPDATE trigger's WHEN clause omits
-- sort_order, so a reorder produces no version bump and no change event. Adding
-- any other column to this UPDATE would turn one drag into up to 20 change
-- events fanned out to every connection.
-- ============================================================================

create or replace function reorder_custom_fields(field_ids uuid[])
returns void as $$
begin
  update custom_fields cf
     set sort_order = t.ord
    from unnest(field_ids) with ordinality as t(id, ord)
   where cf.id = t.id
     and cf.profile_id = auth.uid();
end;
$$ language plpgsql security invoker set search_path = public, pg_temp;

revoke all on function reorder_custom_fields(uuid[]) from public;
grant execute on function reorder_custom_fields(uuid[]) to authenticated;

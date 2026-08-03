-- Catalog stores are soft-deleted so historical products and orders keep their
-- original scope. Only empty, non-default stores can be archived.

create or replace function public.admin_archive_catalog_store(
  p_store_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_store public.catalog_stores%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_store_id is null then
    raise exception 'catalog_store_delete_invalid' using errcode = '22023';
  end if;

  select store.* into v_store
  from public.catalog_stores as store
  where store.id = p_store_id
    and store.archived_at is null
  for update;

  if not found then
    raise exception 'catalog_store_not_found' using errcode = 'P0002';
  end if;
  if v_store.is_default then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_default_protected',
      message = 'catalog_store_default_protected';
  end if;
  if exists (
    select 1
    from public.products as product
    where product.catalog_store_id = p_store_id
      and product.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_not_empty',
      message = 'catalog_store_not_empty';
  end if;

  update public.catalog_stores
  set status = 'archived', archived_at = now()
  where id = p_store_id;

  return true;
end
$$;

comment on function public.admin_archive_catalog_store(uuid) is
  'Soft-deletes an empty non-default catalog store while preserving historical references.';

revoke all on function public.admin_archive_catalog_store(uuid) from public;
revoke all on function public.admin_archive_catalog_store(uuid) from anon;
grant execute on function public.admin_archive_catalog_store(uuid) to authenticated;
grant execute on function public.admin_archive_catalog_store(uuid) to service_role;

create or replace function public.admin_reorder_products(p_product_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_count integer;
  v_requested_count integer;
  v_updated_count integer;
begin
  if auth.role() <> 'service_role'
    and (auth.uid() is null or not private.is_admin()) then
    raise exception 'admin_required'
      using errcode = '42501';
  end if;

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'products_order_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_product_ids) as requested(product_id)
    where requested.product_id is null
    group by requested.product_id
    having count(*) > 0
  ) or exists (
    select 1
    from unnest(p_product_ids) as requested(product_id)
    group by requested.product_id
    having count(*) > 1
  ) then
    raise exception 'products_order_invalid'
      using errcode = '22023';
  end if;

  -- The RPC transaction stays short, while this lock prevents a concurrent
  -- insert/update from producing a partially stale ordering.
  lock table public.products in share row exclusive mode;

  v_requested_count := cardinality(p_product_ids);
  select count(*) into v_product_count from public.products;

  if v_requested_count <> v_product_count
    or exists (
      select 1
      from unnest(p_product_ids) as requested(product_id)
      left join public.products as product on product.id = requested.product_id
      where product.id is null
    ) then
    raise exception 'products_order_stale'
      using errcode = '40001';
  end if;

  update public.products as product
  set sort_order = requested.position - 1
  from unnest(p_product_ids) with ordinality as requested(product_id, position)
  where product.id = requested.product_id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_requested_count then
    raise exception 'products_order_stale'
      using errcode = '40001';
  end if;

  return v_updated_count;
end;
$$;

comment on function public.admin_reorder_products(uuid[]) is
  'Atomically replaces the global product display order after validating a complete, current product list.';

revoke all on function public.admin_reorder_products(uuid[]) from public;
revoke all on function public.admin_reorder_products(uuid[]) from anon;
grant execute on function public.admin_reorder_products(uuid[]) to authenticated;
grant execute on function public.admin_reorder_products(uuid[]) to service_role;

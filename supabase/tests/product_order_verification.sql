begin;

set local client_min_messages = warning;

insert into public.games (id, name, slug, status)
values (
  '83000000-0000-4000-8000-000000000001',
  'Product Order Verification',
  'product-order-verification',
  'inactive'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  'Product Order Verification',
  'product-order-verification',
  'Product Order Verification',
  'inactive'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  status,
  sort_order
)
values
  (
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'Order Verification A',
    'order-verification-a',
    100,
    'inactive',
    1000
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000001',
    'Order Verification B',
    'order-verification-b',
    100,
    'inactive',
    1001
  );

select set_config(
  'request.jwt.claims',
  '{"sub":"86000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.admin_reorder_products(
      array['85000000-0000-4000-8000-000000000002']::uuid[]
    );
    raise exception 'non-admin unexpectedly reordered products';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
declare
  v_ordered_ids uuid[];
begin
  select array_agg(
    product.id
    order by
      case product.id
        when '85000000-0000-4000-8000-000000000002'::uuid then 0
        when '85000000-0000-4000-8000-000000000001'::uuid then 1
        else 2
      end,
      product.sort_order,
      product.name,
      product.id
  )
  into v_ordered_ids
  from public.products as product;

  perform set_config(
    'app.product_order_verification_ids',
    v_ordered_ids::text,
    true
  );
end
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_ordered_ids uuid[] := current_setting('app.product_order_verification_ids')::uuid[];
  v_reordered_count integer;
begin
  v_reordered_count := public.admin_reorder_products(v_ordered_ids);
  if v_reordered_count <> cardinality(v_ordered_ids) then
    raise exception 'product reorder returned the wrong row count';
  end if;

  if public.admin_reorder_products(v_ordered_ids) <> cardinality(v_ordered_ids) then
    raise exception 'idempotent product reorder failed';
  end if;

  begin
    perform public.admin_reorder_products(array_prepend(v_ordered_ids[1], v_ordered_ids));
    raise exception 'duplicate product order was unexpectedly accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.admin_reorder_products(v_ordered_ids[1:cardinality(v_ordered_ids) - 1]);
    raise exception 'stale product order was unexpectedly accepted';
  exception
    when serialization_failure then null;
  end;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.products
    where id = '85000000-0000-4000-8000-000000000002'
      and sort_order = 0
  ) or not exists (
    select 1
    from public.products
    where id = '85000000-0000-4000-8000-000000000001'
      and sort_order = 1
  ) then
    raise exception 'product order was not persisted as requested';
  end if;
end
$$;

rollback;

select 'Product order verification passed' as result;

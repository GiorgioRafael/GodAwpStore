-- Service products have no finite stock; pausing uses the existing catalog status.
-- Keep legacy idempotence, ranking, payment verification and paid financials intact.
begin;
set local lock_timeout = '10s';
alter table public.products add column unlimited_stock boolean not null default false;
alter table public.products add constraint products_service_has_no_stock check (not unlimited_stock or stock_quantity = 0);
comment on column public.products.unlimited_stock is 'Service with unlimited availability. No inventory is consumed; pause using status.';

-- Fail closed if any checkout implementation differs from the reviewed version.
do $patch$
declare
  v_definition text;
  v_function text;
  v_old text;
  v_new text;
  v_patch record;
begin
  for v_function in select distinct function_name from (values
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'if v_product.stock_quantity < p_quantity then', 'if not v_product.unlimited_stock and v_product.stock_quantity < p_quantity then'),
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'set stock_quantity = stock_quantity - p_quantity', 'set stock_quantity = case when unlimited_stock then stock_quantity else stock_quantity - p_quantity end'),
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'and stock_quantity >= p_quantity;', 'and (unlimited_stock or stock_quantity >= p_quantity);'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'if v_product.stock_quantity < v_quantities[v_position] then', 'if not v_product.unlimited_stock and v_product.stock_quantity < v_quantities[v_position] then'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'set stock_quantity = stock_quantity - v_quantities[v_position]', 'set stock_quantity = case when unlimited_stock then stock_quantity else stock_quantity - v_quantities[v_position] end'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'and stock_quantity >= v_quantities[v_position];', 'and (unlimited_stock or stock_quantity >= v_quantities[v_position]);'),
    ('public.create_bot_order_with_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'where id = p_product_id;', 'where id = p_product_id and not unlimited_stock;'),
    ('public.create_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'where product.id = totals.product_id;', 'where product.id = totals.product_id and not product.unlimited_stock;'),
    ('private.commit_paid_order_stock(uuid,timestamp with time zone)', 'or product.stock_quantity < required.quantity', 'or (not product.unlimited_stock and product.stock_quantity < required.quantity)'),
    ('private.commit_paid_order_stock(uuid,timestamp with time zone)', 'where product.id = required.product_id;', 'where product.id = required.product_id and not product.unlimited_stock;')
  ) as patches(function_name, old_text, new_text) loop
    select pg_get_functiondef(v_function::regprocedure) into strict v_definition;
    for v_patch in select * from (values
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'if v_product.stock_quantity < p_quantity then', 'if not v_product.unlimited_stock and v_product.stock_quantity < p_quantity then'),
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'set stock_quantity = stock_quantity - p_quantity', 'set stock_quantity = case when unlimited_stock then stock_quantity else stock_quantity - p_quantity end'),
    ('public.create_bot_order_with_legacy_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'and stock_quantity >= p_quantity;', 'and (unlimited_stock or stock_quantity >= p_quantity);'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'if v_product.stock_quantity < v_quantities[v_position] then', 'if not v_product.unlimited_stock and v_product.stock_quantity < v_quantities[v_position] then'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'set stock_quantity = stock_quantity - v_quantities[v_position]', 'set stock_quantity = case when unlimited_stock then stock_quantity else stock_quantity - v_quantities[v_position] end'),
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'and stock_quantity >= v_quantities[v_position];', 'and (unlimited_stock or stock_quantity >= v_quantities[v_position]);'),
    ('public.create_bot_order_with_reservation(text,uuid,uuid,uuid,text,integer,bigint,bigint,integer,bigint,text,integer)', 'where id = p_product_id;', 'where id = p_product_id and not unlimited_stock;'),
    ('public.create_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'where product.id = totals.product_id;', 'where product.id = totals.product_id and not product.unlimited_stock;'),
    ('private.commit_paid_order_stock(uuid,timestamp with time zone)', 'or product.stock_quantity < required.quantity', 'or (not product.unlimited_stock and product.stock_quantity < required.quantity)'),
    ('private.commit_paid_order_stock(uuid,timestamp with time zone)', 'where product.id = required.product_id;', 'where product.id = required.product_id and not product.unlimited_stock;')
    ) as patches(function_name, old_text, new_text) where function_name = v_function loop
      v_old := v_patch.old_text;
      v_new := v_patch.new_text;
      if position(v_old in v_definition) = 0 then
        raise exception 'Unexpected service checkout definition: % / %', v_function, v_old;
      end if;
      v_definition := replace(v_definition, v_old, v_new);
    end loop;
    execute v_definition;
  end loop;
end
$patch$;

create or replace view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.name as product_name,
  product.substore_id,
  product.stock_quantity::bigint as available_count,
  (
    coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
  )::bigint as reserved_count,
  (
    product.stock_quantity
    + coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
    + coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as total_count,
  product.low_stock_threshold,
  (not product.unlimited_stock and product.stock_quantity <= product.low_stock_threshold) as is_low_stock,
  (
    coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as delivered_count,
  0::bigint as quarantined_count,
  0::bigint as revoked_count,
  product.status as product_status
from public.products as product
left join lateral (
  select
    coalesce(
      sum(item.quantity) filter (
        where order_row.status in ('paid', 'processing')
          and order_row.stock_committed_at is not null
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(item.quantity) filter (
        where order_row.status = 'delivered'
          and order_row.stock_committed_at is not null
      ),
      0
    )::bigint as delivered_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where item.product_id = product.id
) as order_totals on true
left join lateral (
  select
    coalesce(
      sum(prize.quantity) filter (
        where giveaway.status in ('scheduled', 'active', 'drawing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(prize.quantity) filter (where giveaway.status = 'completed'),
      0
    )::bigint as delivered_count
  from public.giveaway_prizes as prize
  join public.giveaways as giveaway on giveaway.id = prize.giveaway_id
  where prize.product_id = product.id
) as giveaway_totals on true;


notify pgrst, 'reload schema';
commit;

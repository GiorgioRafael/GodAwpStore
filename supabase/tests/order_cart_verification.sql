-- Multi-product checkout, idempotency, deferred stock and ticket summary.
-- Every fixture is rolled back.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label)
values ('81000000-0000-4000-8000-000000000001', '810000000000000001', 'Cart seller');

insert into public.games (id, name, slug, status)
values ('82000000-0000-4000-8000-000000000001', 'Cart Game', 'cart-game', 'active');

insert into public.substores (
  id, game_id, name, slug, title, description, status
)
values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'Cart Store',
  'cart-store',
  'Cart Store',
  'Transactional cart fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'Super Watering',
    'cart-super-watering',
    200,
    5,
    'active'
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000001',
    'Super Sprinkler',
    'cart-super-sprinkler',
    300,
    5,
    'active'
  ),
  (
    '84000000-0000-4000-8000-000000000003',
    '83000000-0000-4000-8000-000000000001',
    'Star Fruit',
    'cart-star-fruit',
    100,
    5,
    'active'
  ),
  (
    '84000000-0000-4000-8000-000000000004',
    '83000000-0000-4000-8000-000000000001',
    'Sun Bloom',
    'cart-sun-bloom',
    120,
    5,
    'active'
  ),
  (
    '84000000-0000-4000-8000-000000000005',
    '83000000-0000-4000-8000-000000000001',
    'Dragon Breath',
    'cart-dragon-breath',
    140,
    5,
    'active'
  );

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
)
values (
  '85000000-0000-4000-8000-000000000001',
  '850000000000000001',
  '810000000000000001',
  '81000000-0000-4000-8000-000000000001',
  'Cart Guild',
  'active'
);

do $$
declare
  created record;
  retried record;
  order_row public.orders%rowtype;
  item_count integer;
begin
  select * into strict created
  from public.create_bot_cart_with_reservation(
    '860000000000000001',
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '870000000000000001',
    '[{"product_id":"84000000-0000-4000-8000-000000000001","quantity":2},{"product_id":"84000000-0000-4000-8000-000000000002","quantity":3}]'::jsonb,
    0,
    null,
    1000
  );

  if not created.was_created or created.out_of_stock or created.checkout_order_id is null then
    raise exception 'multi-product order was not created atomically';
  end if;

  select * into strict order_row
  from public.orders
  where id = created.checkout_order_id;

  select count(*) into item_count
  from public.order_items
  where order_id = created.checkout_order_id;

  if order_row.quantity <> 5
    or order_row.subtotal_price_cents <> 1300
    or order_row.sale_price_cents <> 1300
    or item_count <> 2 then
    raise exception 'cart aggregate or normalized items are inconsistent';
  end if;

  if (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 5
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 5 then
    raise exception 'unpaid cart hid product stock';
  end if;

  select * into strict retried
  from public.create_bot_cart_with_reservation(
    '860000000000000001',
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '870000000000000001',
    '[{"product_id":"84000000-0000-4000-8000-000000000001","quantity":2},{"product_id":"84000000-0000-4000-8000-000000000002","quantity":3}]'::jsonb,
    0,
    null,
    1000
  );

  if retried.was_created
    or retried.checkout_order_id <> created.checkout_order_id
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 5
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 5 then
    raise exception 'cart idempotency changed unpaid stock';
  end if;

  update public.orders
  set created_at = now() - interval '3 hours'
  where id = created.checkout_order_id;

  perform *
  from private.expire_unpaid_order(
    created.checkout_order_id,
    now(),
    'scheduled_job'
  );

  if (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 5
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 5
    or (select status from public.orders where id = created.checkout_order_id) <> 'cancelled' then
    raise exception 'expired cart changed stock that was never reserved';
  end if;

  perform *
  from private.expire_unpaid_order(
    created.checkout_order_id,
    now(),
    'scheduled_job'
  );

  if (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 5
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 5 then
    raise exception 'repeated cart expiration changed stock';
  end if;
end
$$;

do $$
declare
  created record;
  item_count integer;
  positions integer[];
begin
  select * into strict created
  from public.create_ranked_bot_cart_with_reservation(
    '860000000000000003',
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '870000000000000001',
    '[
      {"product_id":"84000000-0000-4000-8000-000000000001","quantity":1},
      {"product_id":"84000000-0000-4000-8000-000000000002","quantity":1},
      {"product_id":"84000000-0000-4000-8000-000000000003","quantity":1},
      {"product_id":"84000000-0000-4000-8000-000000000004","quantity":1},
      {"product_id":"84000000-0000-4000-8000-000000000005","quantity":1}
    ]'::jsonb,
    0,
    null,
    1000
  );

  select count(*), array_agg(position order by position)
  into item_count, positions
  from public.order_items
  where order_id = created.checkout_order_id;

  if not created.was_created
    or created.out_of_stock
    or created.checkout_order_id is null
    or item_count <> 5
    or positions <> array[1, 2, 3, 4, 5] then
    raise exception 'five-product cart was not created with stable positions';
  end if;

  if exists (
    select 1
    from public.products
    where id in (
      '84000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000002',
      '84000000-0000-4000-8000-000000000003',
      '84000000-0000-4000-8000-000000000004',
      '84000000-0000-4000-8000-000000000005'
    )
      and stock_quantity <> 5
  ) then
    raise exception 'five-product unpaid cart hid stock';
  end if;
end
$$;

do $$
declare
  created record;
  ticket record;
begin
  select * into strict created
  from public.create_bot_cart_with_reservation(
    '860000000000000002',
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '870000000000000001',
    '[{"product_id":"84000000-0000-4000-8000-000000000001","quantity":1},{"product_id":"84000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb,
    0,
    null,
    1000
  );

  update public.orders
  set status = 'paid', payment_status = 'paid', paid_at = now()
  where id = created.checkout_order_id;

  select * into strict ticket
  from public.claim_discord_ticket(created.checkout_order_id);

  if not ticket.claimed
    or ticket.product_name <> 'Super Watering ×1, Super Sprinkler ×2'
    or ticket.order_quantity <> 3 then
    raise exception 'paid cart ticket did not aggregate its products';
  end if;
end
$$;

rollback;

select 'Multi-product order checks passed' as result;

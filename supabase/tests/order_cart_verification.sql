-- Multi-product checkout, idempotency, stock restoration and ticket summary.
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

  if (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 3
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'cart did not reserve every product quantity';
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
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 3
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'cart idempotency consumed stock twice';
  end if;

  update public.orders
  set payment_expires_at = now() - interval '1 minute'
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
    raise exception 'expired cart did not restore every product exactly once';
  end if;

  perform *
  from private.expire_unpaid_order(
    created.checkout_order_id,
    now(),
    'scheduled_job'
  );

  if (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000001') <> 5
    or (select stock_quantity from public.products where id = '84000000-0000-4000-8000-000000000002') <> 5 then
    raise exception 'repeated cart expiration restored stock twice';
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
